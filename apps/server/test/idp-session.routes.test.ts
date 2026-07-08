import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, SignJWT } from 'jose';
import { createOrgWithOwner, setOrgIdpTenant, setOrgSso } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { verifySessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const PROJECT = 'test-project';
let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let orgId: string;

function mintToken(over: Record<string, unknown> = {}, tenant = 'tenant-acme') {
  return new SignJWT({ email: 'sso@beecause.ai', email_verified: true, name: 'SSO User', firebase: { tenant, sign_in_provider: 'saml.okta' }, ...over })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT).setSubject('sso-uid-1')
    .setIssuedAt('-1m').setExpirationTime('1h').sign(keys.privateKey);
}

beforeAll(async () => {
  t = await startTestDb();
  keys = await generateKeyPair('RS256');
  app = await buildApp({ db: t.db, store: t.store, config: { ...testConfig, IDP_PROJECT_ID: PROJECT }, idpVerifyKey: keys.publicKey });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  orgId = org.id;
  await setOrgIdpTenant(t.db, org.id, 'tenant-acme');
});
afterAll(async () => { await app.close(); await t.stop(); });

function post(idToken: string, ip: string) {
  return app.inject({ method: 'POST', url: '/auth/session', remoteAddress: ip, headers: HOST, payload: { idToken } });
}

describe('POST /auth/session', () => {
  it('valid token for the org tenant → 200 + __session with the IdP uid', async () => {
    const res = await post(await mintToken(), '10.1.0.1');
    expect(res.statusCode).toBe(200);
    const sc = res.headers['set-cookie'] as string | string[];
    const raw = (Array.isArray(sc) ? sc.join(';') : sc).match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]!;
    const user = await verifySessionToken(decodeURIComponent(raw), testConfig.SESSION_SECRET);
    expect(user).toMatchObject({ sub: 'sso-uid-1', email: 'sso@beecause.ai', name: 'SSO User' });
  });

  it('token for a DIFFERENT tenant → 401 (tenant binding)', async () => {
    const res = await post(await mintToken({}, 'tenant-other'), '10.1.0.2');
    expect(res.statusCode).toBe(401);
  });

  it('invalid token → 401', async () => {
    const res = await post('garbage', '10.1.0.3');
    expect(res.statusCode).toBe(401);
  });

  it('upserts the user row', async () => {
    await post(await mintToken(), '10.1.0.4');
    const snap = await t.store.db.collection('users').doc('sso-uid-1').get();
    expect((snap.data() as { email?: string } | undefined)?.email).toBe('sso@beecause.ai');
  });

  it('non-org host → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/session', remoteAddress: '10.1.0.5',
      headers: { 'x-forwarded-host': 'beecause.ai' }, payload: { idToken: await mintToken() } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /auth/sso-info', () => {
  it('returns ssoEnabled=false (+ null ids) when the org has no SSO provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso-info', remoteAddress: '10.3.0.1', headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ssoEnabled: false, tenantId: null, providerId: null });
  });
  it('returns tenantId + providerId when SSO is enabled', async () => {
    await setOrgSso(t.db, orgId, { ssoProvider: 'saml.acme', ssoEnabled: true });
    const res = await app.inject({ method: 'GET', url: '/auth/sso-info', remoteAddress: '10.3.0.2', headers: HOST });
    expect(res.json()).toEqual({ ssoEnabled: true, tenantId: 'tenant-acme', providerId: 'saml.acme' });
    await setOrgSso(t.db, orgId, { ssoProvider: null, ssoEnabled: false });
  });
  it('404 on a non-org host', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso-info', remoteAddress: '10.3.0.3', headers: { 'x-forwarded-host': 'beecause.ai' } });
    expect(res.statusCode).toBe(404);
  });
});
