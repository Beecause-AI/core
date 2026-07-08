import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, createProject, addProjectMember, upsertIntegration } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>, padminCookie: Record<string, string>, plainCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id); // host routing (resolveOrg) requires status==='active'
  const plainId = `${org.id}_u-plain`;
  await t.store.db.collection('org_members').doc(plainId).set({ id: plainId, orgId: org.id, userId: 'u-plain', role: 'user', createdAt: new Date() });
  const p1 = await createProject(t.db, org.id, { name: 'P1', slug: 'p1' });
  await createProject(t.db, org.id, { name: 'P2', slug: 'p2' });
  // u-padmin: org member 'user' + project admin of p1
  await addProjectMember(t.db, org.id, p1.id, 'u-padmin', 'admin');
  await upsertIntegration(t.db, {
    orgId: org.id, provider: 'slack', mode: 'oauth', accountLabel: 'Acme HQ',
    metadata: { teamId: 'T1' }, secretCiphertext: 'fake', connectedByUserId: 'u-owner', lastTestOk: true,
  });
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner' }, testConfig.SESSION_SECRET) };
  padminCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-padmin' }, testConfig.SESSION_SECRET) };
  plainCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-plain' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const get = (path: string, cookies: Record<string, string>) =>
  app.inject({ method: 'GET', url: path, cookies, headers: ACM_HOST });

describe('GET /api/org/slack-connect-context', () => {
  it('org admin sees all projects + connected:true', async () => {
    const res = await get('/api/org/slack-connect-context?team=T1&channel=C9', ownerCookie);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.connected).toBe(true);
    expect(b.orgName).toBe('Acme');
    expect(b.channelId).toBe('C9');
    expect(b.projects.map((p: any) => p.slug).sort()).toEqual(['p1', 'p2']);
  });
  it('project admin sees only their admin project', async () => {
    const res = await get('/api/org/slack-connect-context?team=T1&channel=C9', padminCookie);
    expect(res.json().projects.map((p: any) => p.slug)).toEqual(['p1']);
  });
  it('plain member sees an empty project list', async () => {
    const res = await get('/api/org/slack-connect-context?team=T1&channel=C9', plainCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toEqual([]);
  });
  it('wrong team (different workspace than session) → 403', async () => {
    const res = await get('/api/org/slack-connect-context?team=T_OTHER&channel=C9', ownerCookie);
    expect(res.statusCode).toBe(403);
  });
  it('unauthenticated → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/slack-connect-context?team=T1&channel=C9', headers: ACM_HOST });
    expect(res.statusCode).toBe(401);
  });
});
