import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, setOrgIdpTenant } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, verifySessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig, fakeIdpAdmin, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let idp: ReturnType<typeof fakeIdpAdmin>;
let cookie: Record<string, string>;
let userId: string;
let tenantId: string;

beforeAll(async () => {
  t = await startTestDb();
  idp = fakeIdpAdmin();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, idpAdmin: idp.api, email: fakeEmail().api });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'placeholder' });
  ({ tenantId } = await idp.api.createTenant({ displayName: 'Acme' }));
  await setOrgIdpTenant(t.db, org.id, tenantId);
  const u = await idp.api.createUser(tenantId, { email: 'ada@x.dev', password: 'pw', name: 'Ada Old', emailVerified: true });
  userId = u.uid;
  const omId = `${org.id}_${userId}`;
  await t.store.db.collection('org_members').doc(omId).set({ id: omId, orgId: org.id, userId, role: 'owner', createdAt: new Date() });
  cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: userId, email: 'ada@x.dev', name: 'Ada Old' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

function patch(payload: Record<string, string>, cookies = cookie) {
  return app.inject({ method: 'PATCH', url: '/api/me/profile', cookies, headers: ACM_HOST, payload });
}

describe('PATCH /api/me/profile', () => {
  it('updates the name in Identity Platform and re-issues the session cookie with the new name', async () => {
    const res = await patch({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace' });

    const idpUser = idp.tenants.get(tenantId)!.get(userId)!;
    expect(idpUser.displayName).toBe('Ada Lovelace');

    const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = setCookies.find((c) => c.startsWith('__session='))!;
    const jwt = session.split(';')[0]!.slice('__session='.length);
    const user = await verifySessionToken(jwt, testConfig.SESSION_SECRET);
    expect(user).toMatchObject({ sub: userId, name: 'Ada Lovelace' });
  });

  it('rejects empty names with 400', async () => {
    const res = await patch({ firstName: '', lastName: '' });
    expect(res.statusCode).toBe(400);
  });

  it('401s without a session', async () => {
    const res = await patch({ firstName: 'A', lastName: 'B' }, {});
    expect(res.statusCode).toBe(401);
  });

  it('404s when the session user is not a member of the host org', async () => {
    const strangerCookie = {
      [SESSION_COOKIE]: await createSessionToken({ sub: 'not-a-member', email: 'stranger@x.dev', name: 'No One' }, testConfig.SESSION_SECRET),
    };
    const res = await patch({ firstName: 'X', lastName: 'Y' }, strangerCookie);
    expect(res.statusCode).toBe(404);
  });
});
