import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { requireMember, requireUser } from '../src/auth/guard.js';
import { startTestDb, testConfig } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  // Guard tests don't touch the DB; a cast keeps the helper-free setup small.
  app = await buildApp({ db: null as never, store: null as never, config: testConfig });
  app.get('/protected', { preHandler: requireUser }, async (req) => ({ sub: req.user!.sub }));
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe('requireUser', () => {
  it('rejects requests with no cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a bad cookie', async () => {
    const res = await app.inject({
      method: 'GET', url: '/protected', cookies: { [SESSION_COOKIE]: 'garbage' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid session', async () => {
    const token = await createSessionToken({ sub: 'u1' }, testConfig.SESSION_SECRET);
    const res = await app.inject({
      method: 'GET', url: '/protected', cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: 'u1' });
  });
});

describe('requireMember', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let mApp: FastifyInstance;
  let orgId: string;

  beforeAll(async () => {
    t = await startTestDb();
    mApp = await buildApp({ db: t.db, store: t.store, config: testConfig });
    mApp.get('/orgs/:orgId/thing', { preHandler: [requireUser, requireMember] }, async () => ({ ok: true }));
    await mApp.ready();
    orgId = (await createOrgWithOwner(t.db, { name: 'A', slug: 'a', userId: 'member-1' })).id;
  });
  afterAll(async () => { await mApp.close(); await t.stop(); });

  it('allows members through', async () => {
    const token = await createSessionToken({ sub: 'member-1' }, testConfig.SESSION_SECRET);
    const res = await mApp.inject({ method: 'GET', url: `/orgs/${orgId}/thing`, cookies: { [SESSION_COOKIE]: token } });
    expect(res.statusCode).toBe(200);
  });

  it('hides the org from non-members with 404', async () => {
    const token = await createSessionToken({ sub: 'stranger' }, testConfig.SESSION_SECRET);
    const res = await mApp.inject({ method: 'GET', url: `/orgs/${orgId}/thing`, cookies: { [SESSION_COOKIE]: token } });
    expect(res.statusCode).toBe(404);
  });

  it('401s unauthenticated requests before touching the DB', async () => {
    const res = await mApp.inject({ method: 'GET', url: `/orgs/${orgId}/thing` });
    expect(res.statusCode).toBe(401);
  });
});
