import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createOrgWithOwner,
  createProject, addProjectMember, createAssistant,
  createConversation, appendConversationMessage,
  createTrace, addTraceStep, recordModelInvocation, setOrgShowCostUsd,
} from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

// IDs populated in beforeAll
let orgId: string;
let p1Id: string;   // the "alpha" project
let p2Id: string;   // a second project owned by the same org
let convId: string; // conversation belonging to p1
let p2ConvId: string; // conversation belonging to p2
let childConvId: string; // sub-agent child of convId (must 404 on the detail endpoint)

// Cookies
let memberCookie: Record<string, string>;  // u-member: project member of p1
let ownerCookie: Record<string, string>;   // u-owner: org owner (implicit project admin)
let outsiderCookie: Record<string, string>; // u-out: not a member of anything

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });

  // Org "acme" with u-owner as owner
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  orgId = org.id;

  // Add u-member as org member so resolveOrg passes, then add to p1 as project member
  const omId = `${orgId}_u-member`;
  await t.store.db.collection('org_members').doc(omId).set({ id: omId, orgId, userId: 'u-member', role: 'user', createdAt: new Date() });

  // Two projects
  const p1 = await createProject(t.db, orgId, { name: 'Alpha', slug: 'alpha' });
  p1Id = p1.id;
  const p2 = await createProject(t.db, orgId, { name: 'Beta', slug: 'beta' });
  p2Id = p2.id;

  // u-member is member of p1 only (not p2)
  await addProjectMember(t.db, orgId, p1Id, 'u-member', 'user');

  // Create an assistant in p1 (conversations reference an assistant)
  const assistant = await createAssistant(t.db, p1Id, { name: 'Helper', persona: '', model: 'gemini-2-flash' });
  const assistantId = assistant.id;

  // Create an assistant in p2
  const assistant2 = await createAssistant(t.db, p2Id, { name: 'Helper2', persona: '', model: 'gemini-2-flash' });
  const assistant2Id = assistant2.id;

  // Create a conversation in p1 with 2 messages and a trace with 2 steps
  const convo = await createConversation(t.db, {
    orgId, projectId: p1Id, assistantId, source: 'web',
  });
  convId = convo.id;

  await appendConversationMessage(t.db, { conversationId: convId, role: 'user', content: 'Hello' });
  await appendConversationMessage(t.db, { conversationId: convId, role: 'assistant', content: 'Hi there!' });

  const trace = await createTrace(t.db, { orgId, conversationId: convId });
  const now = new Date();
  await addTraceStep(t.db, {
    traceId: trace.id, type: 'model_call', name: 'llm', status: 'ok',
    startedAt: now, endedAt: now, latencyMs: 100,
  });
  await addTraceStep(t.db, {
    traceId: trace.id, type: 'tool_call', name: 'search', status: 'ok',
    startedAt: now, endedAt: now, latencyMs: 50,
  });

  // A sub-agent child conversation + a delegate handover so the thread builder has a handover.
  const childAssistant = await createAssistant(t.db, p1Id, { name: 'Specialist', persona: '', model: 'gemini-2-flash' });
  const child = await createConversation(t.db, {
    orgId, projectId: p1Id, assistantId: childAssistant.id, source: 'internal', rootConversationId: convId,
  });
  childConvId = child.id;
  await recordModelInvocation(t.db, { source: 'conversation', model: 'm', conversationId: child.id, status: 'ok', output: 'specialist finding' });
  await addTraceStep(t.db, {
    traceId: trace.id, type: 'tool_call', name: `agent.${childAssistant.id}`, status: 'ok',
    startedAt: now, endedAt: now, latencyMs: 10, args: 'go look', result: 'specialist finding',
    childConversationId: child.id,
  });
  await recordModelInvocation(t.db, { source: 'conversation', model: 'm', conversationId: convId, status: 'ok', output: 'Hi there!' });

  // Create a conversation in p2 (cross-project isolation test)
  const p2Conv = await createConversation(t.db, {
    orgId, projectId: p2Id, assistantId: assistant2Id,
  });
  p2ConvId = p2Conv.id;

  // Session cookies
  memberCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-member', email: 'member@x.dev' }, testConfig.SESSION_SECRET) };
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, testConfig.SESSION_SECRET) };
  outsiderCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-out', email: 'out@x.dev' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

// ── GET /api/org/projects/:slug/conversations ─────────────────────────────────

describe('GET /api/org/projects/:slug/conversations', () => {
  it('returns roots-only summaries (member) — excludes the internal child', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects/alpha/conversations', cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; title: string; source: string; agentCount: number }[];
    const row = body.find((c) => c.id === convId)!;
    expect(row).toBeDefined();
    expect(row.agentCount).toBeGreaterThanOrEqual(2); // root + child assistant
    // the internal child conversation must never be its own row
    expect(body.every((c) => c.source !== 'internal')).toBe(true);
  });

  it('returns 200 for org owner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects/alpha/conversations', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }[]).some((c) => c.id === convId)).toBe(true);
  });

  it('returns 401 unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects/alpha/conversations', headers: ACM_HOST });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a non-member', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects/alpha/conversations', cookies: outsiderCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /api/org/projects/:slug/conversations/:id ─────────────────────────────

describe('GET /api/org/projects/:slug/conversations/:id', () => {
  it('returns a thread: participants, an assistant message, and a handover marker', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversationId: string;
      participants: { key: string; role: string }[];
      events: { kind: string; text?: string; toName?: string }[];
    };
    expect(body.conversationId).toBe(convId);
    expect(body.participants.some((p) => p.role === 'human')).toBe(true);
    expect(body.events.some((e) => e.kind === 'message' && e.text === 'Hi there!')).toBe(true);
    expect(body.events.some((e) => e.kind === 'handover')).toBe(true);
  });

  it('always includes token totals; cost is null until the org enables showCostUsd', async () => {
    await setOrgShowCostUsd(t.db, orgId, false);
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}`, cookies: memberCookie, headers: ACM_HOST });
    const body = res.json() as { totals: { inputTokens: number; outputTokens: number; costUsd: string | null } };
    expect(typeof body.totals.inputTokens).toBe('number');
    expect(typeof body.totals.outputTokens).toBe('number');
    expect(body.totals.costUsd).toBeNull();
  });

  it('surfaces cost once the org enables showCostUsd', async () => {
    await setOrgShowCostUsd(t.db, orgId, true);
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}`, cookies: memberCookie, headers: ACM_HOST });
    const body = res.json() as { totals: { costUsd: string | null } };
    expect(typeof body.totals.costUsd).toBe('string');
    await setOrgShowCostUsd(t.db, orgId, false); // restore default for other tests
  });

  it('returns 404 for a sub-agent child conversation (only roots are addressable)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${childConvId}`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the conversation belongs to a different project (cross-project isolation)', async () => {
    // p2Conv belongs to 'beta', but we query via 'alpha' — must 404
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/conversations/${p2ConvId}`,
      cookies: ownerCookie, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a non-existent conversation id', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects/alpha/conversations/00000000-0000-0000-0000-000000000000',
      cookies: memberCookie, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}`,
      headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a user who is not a project member', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}`,
      cookies: outsiderCookie, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});
