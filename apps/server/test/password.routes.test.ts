import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, setOrgIdpTenant } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { verifySessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { IdpInvalidCredentialsError } from '../src/integrations/idp/signin.js';
import { startTestDb, testConfig } from './helpers.js';

const HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

beforeAll(async () => {
  t = await startTestDb();
  const idpSignIn = vi.fn(async (tenantId: string, email: string, password: string) => {
    if (password !== 'right') throw new IdpInvalidCredentialsError();
    return { uid: 'idp-uid-1', email, name: 'Ada Lovelace', idToken: 'ID.TOK' };
  });
  app = await buildApp({ db: t.db, store: t.store, config: { ...testConfig, IDP_API_KEY: 'test-key' }, idpSignIn });

  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await setOrgIdpTenant(t.db, org.id, 'tenant-acme');
});
afterAll(async () => { await app.close(); await t.stop(); });

function login(payload: Record<string, string>, ip: string) {
  return app.inject({ method: 'POST', url: '/auth/password', remoteAddress: ip, headers: HOST, payload });
}

describe('POST /auth/password', () => {
  it('valid credentials → 200 and a __session cookie carrying the IdP uid', async () => {
    const res = await login({ email: 'pocuser@beecause.ai', password: 'right' }, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string | string[];
    const raw = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie).match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]!;
    const user = await verifySessionToken(decodeURIComponent(raw), testConfig.SESSION_SECRET);
    expect(user).toMatchObject({ sub: 'idp-uid-1', email: 'pocuser@beecause.ai', name: 'Ada Lovelace' });
  });

  it('wrong password → 401, no session cookie', async () => {
    const res = await login({ email: 'pocuser@beecause.ai', password: 'wrong' }, '10.0.0.2');
    expect(res.statusCode).toBe(401);
  });

  it('upserts the user row from the IdP uid + email', async () => {
    await login({ email: 'pocuser@beecause.ai', password: 'right' }, '10.0.0.3');
    const userSnap = await t.store.db.collection('users').doc('idp-uid-1').get();
    expect(userSnap.data()?.email).toBe('pocuser@beecause.ai');
  });

  it('non-org host → 400 (resolveOrg rejects)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/password', remoteAddress: '10.0.0.4',
      headers: { 'x-forwarded-host': 'beecause.ai' }, payload: { email: 'a@b.co', password: 'right' } });
    expect(res.statusCode).toBe(400);
  });
});
