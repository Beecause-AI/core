import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createOrgWithOwner,
  createProject, addProjectMember,
  createAssistant, createConversation,
  createConversationReport,
  createReportOffer, claimReportOffer, markReportOfferGenerated,
} from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const REPORT_HTML = '<!doctype html><html><body>REPORT_OK</body></html>';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

let orgId: string;
let p1Id: string;   // the "alpha" project
let convId: string; // conversation belonging to p1
let reportId: string;   // report belonging to p1's conversation

let memberCookie: Record<string, string>;  // u-member: project member of p1
let ownerCookie: Record<string, string>;   // u-owner: org owner (implicit project admin)
let outsiderCookie: Record<string, string>; // u-out: not a member of anything

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });

  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  orgId = org.id;

  // Add u-member as org member so resolveOrg passes, then add to p1 as project member
  const omId = `${orgId}_u-member`;
  await t.store.db.collection('org_members').doc(omId).set({ id: omId, orgId, userId: 'u-member', role: 'user', createdAt: new Date() });

  const p1 = await createProject(t.db, orgId, { name: 'Alpha', slug: 'alpha' });
  p1Id = p1.id;

  await addProjectMember(t.db, orgId, p1Id, 'u-member', 'user');

  const assistant = await createAssistant(t.db, p1Id, { name: 'Helper', persona: '', model: 'gemini-2-flash' });
  const convo = await createConversation(t.db, { orgId, projectId: p1Id, assistantId: assistant.id, source: 'web' });
  convId = convo.id;

  const report = await createConversationReport(t.db, {
    conversationId: convId, orgId, projectId: p1Id, html: REPORT_HTML,
  });
  reportId = report.id;

  memberCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-member', email: 'member@x.dev' }, testConfig.SESSION_SECRET) };
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, testConfig.SESSION_SECRET) };
  outsiderCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-out', email: 'out@x.dev' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

// ── GET /api/reports/:id (host-agnostic) ──────────────────────────────────────

describe('GET /api/reports/:id', () => {
  it('serves the report HTML to a project member', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}`, cookies: memberCookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('REPORT_OK');
  });

  it('sets CSP and nosniff headers on the inline-view response', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}`, cookies: memberCookie });
    expect(res.statusCode).toBe(200);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets nosniff header on the ?download=1 response', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}?download=1`, cookies: memberCookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves the report to the org owner', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}`, cookies: ownerCookie });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('REPORT_OK');
  });

  it('sets an attachment Content-Disposition when ?download=1', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}?download=1`, cookies: memberCookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="report-${reportId}.html"`);
    expect(res.body).toContain('REPORT_OK');
  });

  it('returns 404 for an unknown report id (no existence leak)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/00000000-0000-0000-0000-000000000000', cookies: memberCookie });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a user who is not a member of the report org (no existence leak)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reports/${reportId}`, cookies: outsiderCookie });
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /api/org/projects/:slug/conversations/:cid/reports ────────────────────

describe('GET /api/org/projects/:slug/conversations/:cid/reports', () => {
  it('lists the conversation reports with version for a member', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}/reports`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; version: number; createdAt: string }[];
    const row = body.find((r) => r.id === reportId)!;
    expect(row).toBeDefined();
    expect(row.version).toBe(1);
  });

  it('returns 401 unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}/reports`, headers: ACM_HOST });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a non-member', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}/reports`, cookies: outsiderCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /api/org/projects/:slug/conversations/:cid/report-offer ───────────────

describe('GET /api/org/projects/:slug/conversations/:cid/report-offer', () => {
  async function newConvId(): Promise<string> {
    const a = await createAssistant(t.db, p1Id, { name: 'Helper', persona: '', model: 'gemini-2-flash' });
    const c = await createConversation(t.db, { orgId, projectId: p1Id, assistantId: a.id, source: 'web' });
    return c.id;
  }
  const offerInput = (cid: string) => ({ orgId, projectId: p1Id, conversationId: cid, slackChannelId: 'C1', slackThreadTs: '1.1' });

  it('returns {status:generating} for an in-flight offer', async () => {
    const cid = await newConvId();
    const offer = await createReportOffer(t.db, offerInput(cid));
    await claimReportOffer(t.db, offer.id); // offered → generating
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${cid}/report-offer`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string; reportId: string | null };
    expect(body.status).toBe('generating');
    expect(body.id).toBe(offer.id);
    expect(body.reportId).toBeNull();
  });

  it('returns reportId/reportUrl for a generated offer', async () => {
    const cid = await newConvId();
    const offer = await createReportOffer(t.db, offerInput(cid));
    await claimReportOffer(t.db, offer.id);
    await markReportOfferGenerated(t.db, offer.id, { reportId: 'rep-99', reportUrl: 'https://x/rep-99', decidedBy: 'U7' });
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${cid}/report-offer`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; reportId: string; reportUrl: string };
    expect(body.status).toBe('generated');
    expect(body.reportId).toBe('rep-99');
    expect(body.reportUrl).toBe('https://x/rep-99');
  });

  it('returns null when the conversation has no offer', async () => {
    const cid = await newConvId();
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${cid}/report-offer`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.body === '' || res.body === 'null').toBe(true);
  });

  it('does not leak an offer scoped to a different project (cross-tenant guard)', async () => {
    const cid = await newConvId();
    // An offer whose projectId does not match the resolved project must not surface.
    await createReportOffer(t.db, { ...offerInput(cid), projectId: 'other-project' });
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${cid}/report-offer`, cookies: memberCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.body === '' || res.body === 'null').toBe(true);
  });

  it('returns 401 unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}/report-offer`, headers: ACM_HOST });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a non-member', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/alpha/conversations/${convId}/report-offer`, cookies: outsiderCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});
