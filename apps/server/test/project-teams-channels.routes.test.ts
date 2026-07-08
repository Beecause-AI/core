import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, createProject, addProjectMember, upsertIntegration } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'tmstest.beecause.ai' };

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

  // ── Org 'tmstest' ─────────────────────────────────────────────────────────────
  const org = await createOrgWithOwner(t.db, { name: 'TeamsTest', slug: 'tmstest', userId: 'u-tms-owner' });
  await activateOrg(t.db, org.id);

  // Org member (no project membership)
  const userMemberId = `${org.id}_u-tms-user`;
  await t.store.db.collection('org_members').doc(userMemberId).set({ id: userMemberId, orgId: org.id, userId: 'u-tms-user', role: 'user', createdAt: new Date() });

  // Projects p1 and p2
  const p1 = await createProject(t.db, org.id, { name: 'TP1', slug: 'tp1' });
  const p2 = await createProject(t.db, org.id, { name: 'TP2', slug: 'tp2' });
  p1Id = p1.id;
  p2Id = p2.id;

  // u-tms-padmin: org member 'user' + project admin of p1 only
  await addProjectMember(t.db, org.id, p1Id, 'u-tms-padmin', 'admin');

  // Teams integration for tmstest
  await upsertIntegration(t.db, {
    orgId: org.id,
    provider: 'teams',
    mode: 'oauth',
    accountLabel: 'TeamsTest HQ',
    metadata: { tenantId: 'T-TMS-1' },
    secretCiphertext: 'fake-ciphertext-teams',
    connectedByUserId: 'u-tms-owner',
    lastTestOk: true,
  });

  // Session cookies
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-tms-owner', email: 'tmsowner@x.dev' }, testConfig.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-tms-user', email: 'tmsuser@x.dev' }, testConfig.SESSION_SECRET) };
  padminCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-tms-padmin', email: 'tmspadmin@x.dev' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

// ── helpers ──────────────────────────────────────────────────────────────────
const get = (path: string, cookies = ownerCookie, headers = ACM_HOST) =>
  app.inject({ method: 'GET', url: path, cookies, headers });
const post = (path: string, payload: Record<string, unknown>, cookies = ownerCookie, headers = ACM_HOST) =>
  app.inject({ method: 'POST', url: path, cookies, headers, payload });
const del = (path: string, cookies = ownerCookie, headers = ACM_HOST) =>
  app.inject({ method: 'DELETE', url: path, cookies, headers });

// ── Case 1: project-admin claims a FREE conversation ──────────────────────────
describe('case 1: project-admin claims a free conversation', () => {
  it('POST /tp1/teams-channels with free conversationId → 201, bound to p1', async () => {
    const res = await post('/api/org/projects/tp1/teams-channels', { conversationId: 'CV1' }, padminCookie);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.projectId).toBe(p1Id);
    expect(body.status).toBe('bound');
    expect(body.teamsConversationId).toBe('CV1');
  });
});

// ── Case 2: GET scoping ───────────────────────────────────────────────────
describe('case 2: GET scoping', () => {
  it('org admin binds CV2 to tp2; padmin GET /tp1/teams-channels sees only p1 conversations', async () => {
    // bind CV2 to tp2 as owner
    const bind = await post('/api/org/projects/tp2/teams-channels', { conversationId: 'CV2' }, ownerCookie);
    expect(bind.statusCode).toBe(201);

    const res = await get('/api/org/projects/tp1/teams-channels', padminCookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(Array.isArray(body.assigned)).toBe(true);
    expect(Array.isArray(body.available)).toBe(true);
    // p1 only has CV1; CV2 belongs to p2
    const convIds = body.assigned.map((b: { teamsConversationId: string }) => b.teamsConversationId);
    expect(convIds).toContain('CV1');
    expect(convIds).not.toContain('CV2');
    // CV2 must NOT appear in p1's view (available = unbound conversations only)
    const availableIds = body.available.map((b: { teamsConversationId: string }) => b.teamsConversationId);
    expect(availableIds).not.toContain('CV2');
  });
});

// ── Case 4: project-admin blocked on taken conversation (no p2 leak) ─────────
describe('case 4: project-admin blocked on taken conversation', () => {
  it('POST /tp1/teams-channels with CV2 (bound to p2) → 409; no p2.id leak', async () => {
    const res = await post('/api/org/projects/tp1/teams-channels', { conversationId: 'CV2' }, padminCookie);
    expect(res.statusCode).toBe(409);
    const bodyStr = JSON.stringify(res.json());
    expect(bodyStr).not.toContain(p2Id);
  });
});

// ── Case 5: org-admin reassigns taken conversation ───────────────────────────
describe('case 5: org-admin reassigns taken conversation', () => {
  it('owner POST /tp1/teams-channels with CV2 (taken) → 200 or 201; now bound to p1', async () => {
    const res = await post('/api/org/projects/tp1/teams-channels', { conversationId: 'CV2' }, ownerCookie);
    expect([200, 201]).toContain(res.statusCode);
    const body = res.json();
    expect(body.projectId).toBe(p1Id);
    expect(body.status).toBe('bound');
  });
});

// ── Case 6: non-member is 404'd ───────────────────────────────────────────
describe('case 6: non-member gets 404', () => {
  it('GET /tp1/teams-channels as u-tms-user → 404', async () => {
    const res = await get('/api/org/projects/tp1/teams-channels', userCookie);
    expect(res.statusCode).toBe(404);
  });

  it('POST /tp1/teams-channels as u-tms-user → 404', async () => {
    const res = await post('/api/org/projects/tp1/teams-channels', { conversationId: 'CVX' }, userCookie);
    expect(res.statusCode).toBe(404);
  });
});

// ── Case 8: DELETE ────────────────────────────────────────────────────────
describe('case 8: DELETE binding', () => {
  it('DELETE /tp1/teams-channels/CV1 → 204; then GET shows it gone', async () => {
    const res = await del('/api/org/projects/tp1/teams-channels/CV1', padminCookie);
    expect(res.statusCode).toBe(204);

    const listRes = await get('/api/org/projects/tp1/teams-channels', padminCookie);
    const body = listRes.json();
    const convIds = body.assigned.map((b: { teamsConversationId: string }) => b.teamsConversationId);
    expect(convIds).not.toContain('CV1');
  });
});

// ── Case 9: not connected ─────────────────────────────────────────────────
// Use a second org (no Teams integration) seeded into the SAME database/app.
describe('case 9: not connected (second org)', () => {
  let owner4Cookie: Record<string, string>;
  const ORG4_HOST = { 'x-forwarded-host': 'notms.beecause.ai' };

  beforeAll(async () => {
    const org4 = await createOrgWithOwner(t.db, { name: 'NoTeams', slug: 'notms', userId: 'u-owner4' });
    await activateOrg(t.db, org4.id);
    await createProject(t.db, org4.id, { name: 'Proj', slug: 'notmsp' });
    // No Teams integration for org4

    owner4Cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner4', email: 'owner4@x.dev' }, testConfig.SESSION_SECRET) };
  });

  it('GET /notmsp/teams-channels → 200 {connected:false, assigned:[], available:[]}', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects/notmsp/teams-channels', cookies: owner4Cookie, headers: ORG4_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.assigned).toEqual([]);
    expect(body.available).toEqual([]);
  });

  it('POST /notmsp/teams-channels when not connected → 409', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/org/projects/notmsp/teams-channels', cookies: owner4Cookie, headers: ORG4_HOST, payload: { conversationId: 'CVX' } });
    expect(res.statusCode).toBe(409);
  });
});
