import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, getOrgBySlug, setOrgIdpTenant } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let cookieOwner: Record<string, string>;
let cookieUser: Record<string, string>;

const idpAdmin = {
  createTenant: vi.fn(),
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  createSamlProvider: vi.fn(async (_t: string, p: { providerId: string }) => ({ providerId: p.providerId })),
  createOidcProvider: vi.fn(async (_t: string, p: { providerId: string }) => ({ providerId: p.providerId })),
  listProviders: vi.fn(async () => ['saml.acme']),
  deleteProvider: vi.fn(async () => undefined),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, idpAdmin });

  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await setOrgIdpTenant(t.db, org.id, 'tenant-acme');
  const omId = `${org.id}_u-plain`;
  await t.store.db.collection('org_members').doc(omId).set({ id: omId, orgId: org.id, userId: 'u-plain', role: 'user', createdAt: new Date() });

  cookieOwner = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'o@x.dev' }, testConfig.SESSION_SECRET) };
  cookieUser = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-plain', email: 'p@x.dev' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('POST /api/org/sso', () => {
  it('owner registers a SAML provider → 200, org.ssoProvider=saml.acme, ssoEnabled true', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/sso', cookies: cookieOwner, headers: ACM_HOST, remoteAddress: '10.2.0.1',
      payload: { type: 'saml', displayName: 'Acme Okta', idpEntityId: 'https://idp/e', ssoUrl: 'https://idp/sso', x509Certificate: 'CERT' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().providerId).toBe('saml.acme');
    const org = await getOrgBySlug(t.db, 'acme');
    expect(org!.ssoProvider).toBe('saml.acme');
    expect(org!.ssoEnabled).toBe(true);
    expect(idpAdmin.createSamlProvider).toHaveBeenCalled();
  });

  it('owner registers an OIDC provider → 200, providerId oidc.acme', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/sso', cookies: cookieOwner, headers: ACM_HOST, remoteAddress: '10.2.0.9',
      payload: { type: 'oidc', displayName: 'Acme Entra', issuer: 'https://login.microsoftonline.com/x/v2.0', clientId: 'cid', clientSecret: 'sec' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().providerId).toBe('oidc.acme');
  });

  it('a plain member is rejected (admin-only)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/sso', cookies: cookieUser, headers: ACM_HOST, remoteAddress: '10.2.0.2',
      payload: { type: 'saml', displayName: 'x', idpEntityId: 'a', ssoUrl: 'https://b', x509Certificate: 'c' },
    });
    expect(res.statusCode).toBe(404); // requireOrgAdmin returns 404 (existence-hiding) for non-admins
  });
});

describe('GET /api/org/sso', () => {
  it('owner lists providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/sso', cookies: cookieOwner, headers: ACM_HOST, remoteAddress: '10.2.0.4' });
    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toContain('saml.acme');
  });
});

describe('DELETE /api/org/sso', () => {
  it('owner removes SSO → 200, ssoEnabled false, ssoProvider null', async () => {
    await app.inject({
      method: 'POST', url: '/api/org/sso', cookies: cookieOwner, headers: ACM_HOST, remoteAddress: '10.2.0.5',
      payload: { type: 'saml', displayName: 'Acme Okta', idpEntityId: 'https://idp/e', ssoUrl: 'https://idp/sso', x509Certificate: 'CERT' },
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/org/sso', cookies: cookieOwner, headers: ACM_HOST, remoteAddress: '10.2.0.6' });
    expect(res.statusCode).toBe(200);
    const org = await getOrgBySlug(t.db, 'acme');
    expect(org!.ssoEnabled).toBe(false);
    expect(org!.ssoProvider).toBeNull();
  });
});
