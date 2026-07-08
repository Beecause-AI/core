import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, createProject, addProjectMember, upsertIntegration } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

let ownerCookie: Record<string, string>;
let userCookie: Record<string, string>;
let padminCookie: Record<string, string>;

let p1Id: string;
let p2Id: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });

  // ── Org 'acme' ─────────────────────────────────────────────────────────────
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id); // host routing (resolveOrg) requires status==='active'

  // Org member (no project membership)
  const userMemberId = `${org.id}_u-user`;
  await t.store.db.collection('org_members').doc(userMemberId).set({ id: userMemberId, orgId: org.id, userId: 'u-user', role: 'user', createdAt: new Date() });

  // Projects p1 and p2
  const p1 = await createProject(t.db, org.id, { name: 'P1', slug: 'p1' });
  const p2 = await createProject(t.db, org.id, { name: 'P2', slug: 'p2' });
  p1Id = p1.id;
  p2Id = p2.id;

  // u-padmin: org member 'user' + project admin of p1 only
  await addProjectMember(t.db, org.id, p1Id, 'u-padmin', 'admin');

  // Slack integration for acme
  await upsertIntegration(t.db, {
    orgId: org.id,
    provider: 'slack',
    mode: 'oauth',
    accountLabel: 'Acme HQ',
    metadata: { teamId: 'T1' },
    secretCiphertext: 'fake-ciphertext',
    connectedByUserId: 'u-owner',
    lastTestOk: true,
  });

  // Session cookies
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, testConfig.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-user', email: 'user@x.dev' }, testConfig.SESSION_SECRET) };
  padminCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-padmin', email: 'padmin@x.dev' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

// ── helpers ──────────────────────────────────────────────────────────────────
const get = (path: string, cookies = ownerCookie, headers = ACM_HOST) =>
  app.inject({ method: 'GET', url: path, cookies, headers });
const post = (path: string, payload: Record<string, unknown>, cookies = ownerCookie, headers = ACM_HOST) =>
  app.inject({ method: 'POST', url: path, cookies, headers, payload });
const del = (path: string, cookies = ownerCookie, headers = ACM_HOST) =>
  app.inject({ method: 'DELETE', url: path, cookies, headers });

// ── Case 1: project-admin claims a FREE channel ───────────────────────────
describe('case 1: project-admin claims a free channel', () => {
  it('POST /p1/slack-channels with free channel → 201, bound to p1', async () => {
    const res = await post('/api/org/projects/p1/slack-channels', { channelId: 'C1' }, padminCookie);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.projectId).toBe(p1Id);
    expect(body.status).toBe('bound');
    expect(body.slackChannelId).toBe('C1');
  });
});

// ── Case 2: GET scoping ───────────────────────────────────────────────────
describe('case 2: GET scoping', () => {
  it('org admin binds C2 to p2; padmin GET /p1/slack-channels sees only p1 channels', async () => {
    // bind C2 to p2 as owner
    const bind = await post('/api/org/projects/p2/slack-channels', { channelId: 'C2' }, ownerCookie);
    expect(bind.statusCode).toBe(201);

    const res = await get('/api/org/projects/p1/slack-channels', padminCookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(Array.isArray(body.assigned)).toBe(true);
    expect(Array.isArray(body.available)).toBe(true);
    // p1 only has C1; C2 belongs to p2
    const channelIds = body.assigned.map((b: { slackChannelId: string }) => b.slackChannelId);
    expect(channelIds).toContain('C1');
    expect(channelIds).not.toContain('C2');
    // C2 must NOT appear in p1's view (available = unbound channels only)
    const availableIds = body.available.map((b: { slackChannelId: string }) => b.slackChannelId);
    expect(availableIds).not.toContain('C2');
  });
});

// ── Case 4: project-admin blocked on taken channel (no p2 leak) ──────────
describe('case 4: project-admin blocked on taken channel', () => {
  it('POST /p1/slack-channels with C2 (bound to p2) → 409; no p2.id leak', async () => {
    const res = await post('/api/org/projects/p1/slack-channels', { channelId: 'C2' }, padminCookie);
    expect(res.statusCode).toBe(409);
    const bodyStr = JSON.stringify(res.json());
    expect(bodyStr).not.toContain(p2Id);
  });
});

// ── Case 5: org-admin reassigns taken channel ────────────────────────────
describe('case 5: org-admin reassigns taken channel', () => {
  it('owner POST /p1/slack-channels with C2 (taken) → 201; now bound to p1', async () => {
    const res = await post('/api/org/projects/p1/slack-channels', { channelId: 'C2' }, ownerCookie);
    expect([200, 201]).toContain(res.statusCode);
    const body = res.json();
    expect(body.projectId).toBe(p1Id);
    expect(body.status).toBe('bound');
  });
});

// ── Case 6: non-member is 404'd ───────────────────────────────────────────
describe('case 6: non-member gets 404', () => {
  it('GET /p1/slack-channels as u-user → 404', async () => {
    const res = await get('/api/org/projects/p1/slack-channels', userCookie);
    expect(res.statusCode).toBe(404);
  });

  it('POST /p1/slack-channels as u-user → 404', async () => {
    const res = await post('/api/org/projects/p1/slack-channels', { channelId: 'CX' }, userCookie);
    expect(res.statusCode).toBe(404);
  });
});

// ── Case 8: DELETE ────────────────────────────────────────────────────────
describe('case 8: DELETE binding', () => {
  it('DELETE /p1/slack-channels/C1 → 204; then GET shows it gone', async () => {
    const res = await del('/api/org/projects/p1/slack-channels/C1', padminCookie);
    expect(res.statusCode).toBe(204);

    const listRes = await get('/api/org/projects/p1/slack-channels', padminCookie);
    const body = listRes.json();
    const channelIds = body.assigned.map((b: { slackChannelId: string }) => b.slackChannelId);
    expect(channelIds).not.toContain('C1');
  });
});

// ── Case 9: not connected ─────────────────────────────────────────────────
// Use a second org (no slack integration) seeded into the SAME database/app.
describe('case 9: not connected (second org)', () => {
  let owner3Cookie: Record<string, string>;
  const ORG3_HOST = { 'x-forwarded-host': 'nosl.beecause.ai' };

  beforeAll(async () => {
    const org3 = await createOrgWithOwner(t.db, { name: 'NoSlack', slug: 'nosl', userId: 'u-owner3' });
    await activateOrg(t.db, org3.id); // host routing (resolveOrg) requires status==='active'
    await createProject(t.db, org3.id, { name: 'Proj', slug: 'nosls' });
    // No slack integration for org3

    owner3Cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner3', email: 'owner3@x.dev' }, testConfig.SESSION_SECRET) };
  });

  it('GET /nosls/slack-channels → 200 {connected:false, assigned:[], available:[]}', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects/nosls/slack-channels', cookies: owner3Cookie, headers: ORG3_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.assigned).toEqual([]);
    expect(body.available).toEqual([]);
  });

  it('POST /nosls/slack-channels when not connected → 409', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/org/projects/nosls/slack-channels', cookies: owner3Cookie, headers: ORG3_HOST, payload: { channelId: 'CX' } });
    expect(res.statusCode).toBe(409);
  });
});
