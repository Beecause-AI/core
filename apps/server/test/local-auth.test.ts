import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, upsertUser, setUserPassword, hashPassword, activateOrg } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { verifySessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';
import { singleTenantResolver } from '../src/auth/tenant-resolver.js';
import { localAuthProvider } from '../src/auth/provider.js';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

const ORG_SLUG = 'oss-default';
const USER_EMAIL = 'admin@local.dev';
const USER_PASSWORD = 'c0rrect-h0rse-battery-staple';
const USER_ID = 'local-user-1';

beforeAll(async () => {
  t = await startTestDb();

  // Seed: org + user with a hashed password
  const org = await createOrgWithOwner(t.db, { name: 'OSS Org', slug: ORG_SLUG, userId: USER_ID });
  await activateOrg(t.db, org.id);
  await upsertUser(t.db, { userId: USER_ID, email: USER_EMAIL });
  await setUserPassword(t.db, USER_ID, hashPassword(USER_PASSWORD));

  // Single-tenant resolver so no subdomain is needed
  const tenantResolver = singleTenantResolver(() => t.db.collection('organizations').doc(org.id).get().then((s) => {
    if (!s.exists) return null;
    return { id: s.id, ...(s.data() ?? {}) } as any;
  }));

  const authProvider = localAuthProvider(t.db);

  app = await buildApp({
    db: t.db,
    store: t.store,
    config: { ...testConfig, AUTH_BACKEND: 'local', TENANT_MODE: 'single', SINGLE_TENANT_SLUG: ORG_SLUG },
    tenantResolver,
    authProvider,
  });
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('POST /auth/password (local auth)', () => {
  it('valid credentials → 200 and a __session cookie carrying the local user id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { email: USER_EMAIL, password: USER_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string | string[];
    const raw = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie).match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]!;
    const user = await verifySessionToken(decodeURIComponent(raw), testConfig.SESSION_SECRET);
    expect(user).toMatchObject({ sub: USER_ID, email: USER_EMAIL });
  });

  it('wrong password → 401, no session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { email: USER_EMAIL, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid credentials' });
  });

  it('unknown email → 401, same generic error (no user enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { email: 'nobody@local.dev', password: USER_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid credentials' });
  });
});
