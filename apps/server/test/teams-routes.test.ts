import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createOrgWithOwner, activateOrg, upsertTeamsIntegration } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;
let userCookie: Record<string, string>;
let projectId: string;
let acmeOrgId: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, email: fakeEmail().api });

  // Primary org: acme (slug used for x-forwarded-host routing)
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  acmeOrgId = org.id;
  await activateOrg(t.db, org.id);

  // Plain user member (no admin rights)
  const memberId = `${org.id}_u-user`;
  await t.store.db.collection('org_members').doc(memberId).set({
    id: memberId, orgId: org.id, userId: 'u-user', role: 'user', createdAt: new Date(),
  });

  // Seed a project so channel-binding tests can use a valid projectId
  projectId = randomUUID();
  await t.store.db.collection('projects').doc(projectId).set({
    id: projectId, orgId: org.id, name: 'P', slug: 'p', description: '',
    approvalPolicy: null, activeProposalId: null, createdAt: new Date(), updatedAt: new Date(),
  });

  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, testConfig.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-user', email: 'user@x.dev' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const get = (url: string, cookies = ownerCookie) =>
  app.inject({ method: 'GET', url, cookies, headers: ACM_HOST });
const delConn = (cookies = ownerCookie) =>
  app.inject({ method: 'DELETE', url: '/api/teams/connection', cookies, headers: ACM_HOST });

// ---------------------------------------------------------------------------
// GET /api/teams/connection
// ---------------------------------------------------------------------------
describe('GET /api/teams/connection', () => {
  it('returns null when no integration row exists', async () => {
    const res = await get('/api/teams/connection');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('rejects a non-admin member (404)', async () => {
    const res = await get('/api/teams/connection', userCookie);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/teams/connection
// ---------------------------------------------------------------------------
describe('DELETE /api/teams/connection', () => {
  it('is idempotent (204) when nothing is connected', async () => {
    const res = await delConn();
    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST /api/teams/connection/test
// ---------------------------------------------------------------------------
describe('POST /api/teams/connection/test', () => {
  it('returns ok:false when not connected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/teams/connection/test', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// POST /api/teams/channels — 409 when not connected
// ---------------------------------------------------------------------------
describe('POST /api/teams/channels', () => {
  it('returns 409 when Teams is not yet connected', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/teams/channels', cookies: ownerCookie, headers: ACM_HOST,
      payload: { conversationId: 'conv-1', projectId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'teams not connected' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/teams/channels — empty list when not connected
// ---------------------------------------------------------------------------
describe('GET /api/teams/channels', () => {
  it('returns empty array when not connected', async () => {
    const res = await get('/api/teams/channels');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full CRUD: connect → create binding → list → delete
// ---------------------------------------------------------------------------
describe('Teams channel bindings CRUD (after connect)', () => {
  let integrationId: string;

  beforeAll(async () => {
    // Seed a Teams integration directly via the core helper so we can test CRUD
    const conn = await upsertTeamsIntegration(t.db, {
      orgId: acmeOrgId,
      tenantId: 'tenant-crud', tenantName: 'Acme Tenant',
      serviceUrl: 'https://smba.trafficmanager.net/amer/', botId: 'bot-id-123',
      connectedByUserId: 'u-owner',
    });
    integrationId = conn.id;
  });

  afterAll(async () => {
    await delConn();
  });

  it('GET /api/teams/connection returns the connected row', async () => {
    const res = await get('/api/teams/connection');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: 'teams', mode: 'central' });
  });

  it('POST creates a channel binding (201)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/teams/channels', cookies: ownerCookie, headers: ACM_HOST,
      payload: { conversationId: 'conv-bound', projectId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ teamsConversationId: 'conv-bound', status: 'bound' });
  });

  it('GET lists the binding', async () => {
    const res = await get('/api/teams/channels');
    expect(res.statusCode).toBe(200);
    expect(res.json().some((b: Record<string, unknown>) => b.teamsConversationId === 'conv-bound')).toBe(true);
  });

  it('PUT updates the binding (200)', async () => {
    const newProjectId = randomUUID();
    await t.store.db.collection('projects').doc(newProjectId).set({
      id: newProjectId, orgId: integrationId, name: 'Q', slug: 'q', description: '',
      approvalPolicy: null, activeProposalId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/teams/channels/conv-bound', cookies: ownerCookie, headers: ACM_HOST,
      payload: { projectId: newProjectId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ teamsConversationId: 'conv-bound', projectId: newProjectId });
  });

  it('DELETE removes the binding (204)', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/teams/channels/conv-bound', cookies: ownerCookie, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// GET /api/teams/connect-context — 403 when tenant maps to another org
// ---------------------------------------------------------------------------
describe('GET /api/teams/connect-context', () => {
  let secondOrg: { id: string };

  beforeAll(async () => {
    // Create a second org and seed a Teams integration for it using a different tenant
    secondOrg = await createOrgWithOwner(t.db, { name: 'OtherCo', slug: 'otherco', userId: 'u-other' });
    await activateOrg(t.db, secondOrg.id);
    await upsertTeamsIntegration(t.db, {
      orgId: secondOrg.id,
      tenantId: 'tenant-other', tenantName: 'OtherCo Tenant',
      serviceUrl: 'https://smba.trafficmanager.net/amer/', botId: 'bot-id-other',
      connectedByUserId: 'u-other',
    });
  });

  it('returns 200 with connected:false when tenant is unknown', async () => {
    const res = await get('/api/teams/connect-context?tenant=tenant-new&conversation=conv-xyz');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.connected).toBe(false);
    expect(b.orgName).toBe('Acme');
    expect(b.conversationId).toBe('conv-xyz');
  });

  it('returns 403 when tenant is already mapped to a different org', async () => {
    // Requesting as acme user but the tenant belongs to otherco
    const res = await get('/api/teams/connect-context?tenant=tenant-other&conversation=conv-xyz');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'tenant mapped to another org' });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/connect-context', headers: ACM_HOST });
    expect(res.statusCode).toBe(401);
  });
});
