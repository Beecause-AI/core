/**
 * Tests for GET /auth/methods (public, config-driven).
 *
 * Covers four combinations:
 *   1. AUTH_BACKEND=local, LOCAL_SIGNUP_ENABLED='true', IDP_PROJECT_ID set
 *      → { password:true, oidc:false, sso:true, signup:true }
 *   2. AUTH_BACKEND=local, LOCAL_SIGNUP_ENABLED unset, IDP_PROJECT_ID unset
 *      → { password:true, oidc:false, sso:false, signup:false }
 *   3. AUTH_BACKEND=oidc
 *      → { password:false, oidc:true, sso:false, signup:false }
 *   4. AUTH_BACKEND=gcp, IDP_PROJECT_ID set
 *      → { password:true, oidc:false, sso:true, signup:false }
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { startTestDb, testConfig } from './helpers.js';
import { singleTenantResolver } from '../src/auth/tenant-resolver.js';
import { createOrgWithOwner, activateOrg } from '@intellilabs/core';

const ORG_SLUG = 'auth-methods-test';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app1: FastifyInstance;
let app2: FastifyInstance;
let app3: FastifyInstance;
let app4: FastifyInstance;

beforeAll(async () => {
  t = await startTestDb();

  const org = await createOrgWithOwner(t.db, { name: 'Auth Methods Test Org', slug: ORG_SLUG, userId: 'seed-owner' });
  await activateOrg(t.db, org.id);
  const tenantResolver = singleTenantResolver(async () => org);

  // 1. local + signup enabled + sso via IDP_PROJECT_ID
  app1 = await buildApp({
    db: t.db,
    store: t.store,
    config: {
      ...testConfig,
      AUTH_BACKEND: 'local' as const,
      LOCAL_SIGNUP_ENABLED: 'true' as const,
      IDP_PROJECT_ID: 'my-gcp-project',
      TENANT_MODE: 'single' as const,
      SINGLE_TENANT_SLUG: ORG_SLUG,
    },
    tenantResolver,
  });

  // 2. local + signup disabled + no IDP_PROJECT_ID
  app2 = await buildApp({
    db: t.db,
    store: t.store,
    config: {
      ...testConfig,
      AUTH_BACKEND: 'local' as const,
      TENANT_MODE: 'single' as const,
      SINGLE_TENANT_SLUG: ORG_SLUG,
    },
    tenantResolver,
  });

  // 3. oidc backend
  app3 = await buildApp({
    db: t.db,
    store: t.store,
    config: {
      ...testConfig,
      AUTH_BACKEND: 'oidc' as const,
      OIDC_ISSUER: 'https://example.com',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_CLIENT_SECRET: 'client-secret',
      TENANT_MODE: 'single' as const,
      SINGLE_TENANT_SLUG: ORG_SLUG,
    },
    tenantResolver,
    // Inject a no-op oidcClient so we don't hit real network
    oidcClient: {
      authUrl: async () => new URL('https://example.com/auth'),
      exchange: async () => { throw new Error('not implemented in test'); },
    } as never,
  });

  // 4. gcp backend + IDP_PROJECT_ID set
  app4 = await buildApp({
    db: t.db,
    store: t.store,
    config: {
      ...testConfig,
      AUTH_BACKEND: 'gcp' as const,
      IDP_PROJECT_ID: 'my-gcp-project',
      TENANT_MODE: 'single' as const,
      SINGLE_TENANT_SLUG: ORG_SLUG,
    },
    tenantResolver,
  });
});

afterAll(async () => {
  await app1.close();
  await app2.close();
  await app3.close();
  await app4.close();
  await t.stop();
});

describe('GET /auth/methods', () => {
  it('(1) local + signup enabled + IDP_PROJECT_ID → password:true, oidc:false, sso:true, signup:true', async () => {
    const res = await app1.inject({ method: 'GET', url: '/auth/methods' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ password: true, oidc: false, sso: true, signup: true });
  });

  it('(2) local + no signup + no IDP_PROJECT_ID → password:true, oidc:false, sso:false, signup:false', async () => {
    const res = await app2.inject({ method: 'GET', url: '/auth/methods' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ password: true, oidc: false, sso: false, signup: false });
  });

  it('(3) oidc backend → password:false, oidc:true, sso:false, signup:false', async () => {
    const res = await app3.inject({ method: 'GET', url: '/auth/methods' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ password: false, oidc: true, sso: false, signup: false });
  });

  it('(4) gcp + IDP_PROJECT_ID → password:true, oidc:false, sso:true, signup:false', async () => {
    const res = await app4.inject({ method: 'GET', url: '/auth/methods' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ password: true, oidc: false, sso: true, signup: false });
  });
});
