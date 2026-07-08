import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ─── Intercept markReportOfferFailed so we can make it throw in one test ──────
// vitest hoists vi.mock factories above imports. The factory itself must NOT
// eagerly call methods on module-level variables (they are still in TDZ at
// factory invocation). The closure reference inside the returned object's method
// is fine because it is evaluated lazily, after module init.
// Default call-through is wired in beforeAll via vi.importActual.
const mockMarkReportOfferFailed = vi.fn();

vi.mock('@intellilabs/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@intellilabs/core')>();
  return { ...real, markReportOfferFailed: (...args: any[]) => mockMarkReportOfferFailed(...args) };
});
// ─────────────────────────────────────────────────────────────────────────────

import {
  createOrgWithOwner,
  createProject,
  createConversation,
  appendConversationMessage,
  createReportOffer,
  setReportOfferMessageTs,
  claimReportOffer,
  getReportOffer,
  listReportsForConversation,
} from '@intellilabs/core';
import fastify from 'fastify';
import { runReportRoutes, type ReportConsumerDeps } from '../src/routes/run-report.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let db: any;
let orgId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme-report', userId: 'u1' });
  orgId = org.id;
  // Wire the default: call through to the real Firestore implementation.
  // Doing this here (not in the vi.mock factory) avoids the TDZ problem that
  // occurs when factory code eagerly calls methods on module-level vi.fn() vars.
  const actual = await vi.importActual<typeof import('@intellilabs/core')>('@intellilabs/core');
  mockMarkReportOfferFailed.mockImplementation(actual.markReportOfferFailed);
});
afterAll(async () => { await tdb.stop(); });

const FAKE_HTML = '<!doctype html><html><body><h1>Incident report</h1></body></html>';

/** Seed a project + a slack-rooted conversation with a couple of messages + a report offer
 *  already advanced to `generating` (offered → message posted → claimed). Returns the ids. */
async function seedGeneratingOffer(slug: string) {
  const project = await createProject(db, orgId, { name: slug, slug });
  const convo = await createConversation(db, {
    orgId, projectId: project.id, assistantId: null, source: 'slack',
  });
  await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'why is checkout 500ing?' });
  await appendConversationMessage(db, { conversationId: convo.id, role: 'assistant', content: 'A bad deploy to the payments service.' });
  const offer = await createReportOffer(db, {
    orgId, projectId: project.id, conversationId: convo.id,
    slackChannelId: 'C123', slackThreadTs: '1700.0001',
  });
  await setReportOfferMessageTs(db, offer.id, 'MSG-TS-1');
  const won = await claimReportOffer(db, offer.id);
  expect(won).toBe(true);
  return { project, convo, offerId: offer.id };
}

type Captured = { orgId: string; channel: string; ts: string; text: string };

function buildHarness(deps: Partial<ReportConsumerDeps> & { verify?: boolean } = {}) {
  const updates: Captured[] = [];
  const model = deps.model ?? {
    complete: async () => ({ text: FAKE_HTML, model: 'fake-model', costUsd: '0.000123' }),
  };
  const slack = deps.slack ?? {
    update: async (o: string, channel: string, ts: string, text: string) => { updates.push({ orgId: o, channel, ts, text }); },
  };
  const app = fastify();
  app.setErrorHandler((_err, _req, reply) => { reply.code(500).send({ error: 'internal' }); });
  app.register(runReportRoutes, {
    verify: async () => deps.verify ?? true,
    deps: { db, model, slack, baseUrl: deps.baseUrl ?? 'https://srv.example' },
  });
  return { app, updates };
}

function pushBody(offerId: string) {
  return { message: { data: Buffer.from(JSON.stringify({ offerId })).toString('base64') } };
}

describe('POST /api/internal/run-report', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { app } = buildHarness({ verify: false });
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-report', headers: { authorization: 'Bearer x' }, payload: pushBody('o1') });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('generates the report, stores it versioned, marks the offer generated, and links it in Slack', async () => {
    const { project, convo, offerId } = await seedGeneratingOffer('checkout-svc');
    // REPORT_PUBLIC_BASE_URL is the base domain (beecause.ai); the link should be on the org subdomain.
    const { app, updates } = buildHarness({ baseUrl: 'https://beecause.ai' });
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-report', headers: { authorization: 'Bearer ok' }, payload: pushBody(offerId) });
    expect(res.statusCode).toBe(200);

    // a conversation_reports row was created with the model's HTML + model/cost
    const reports = await listReportsForConversation(db, convo.id);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.html).toBe(FAKE_HTML);
    expect(report.model).toBe('fake-model');
    expect(report.costUsd).toBe('0.000123');
    expect(report.version).toBe(1);

    // the offer is now generated with the canonical org-subdomain report URL
    const offer = await getReportOffer(db, offerId);
    expect(offer?.status).toBe('generated');
    expect(offer?.reportId).toBe(report.id);
    // org slug is 'acme-report' (seeded in beforeAll); link must be on its subdomain
    expect(offer?.reportUrl).toBe(`https://acme-report.beecause.ai/api/reports/${report.id}`);
    expect(offer?.decidedBy).toBe('system');

    // the Slack message was edited to a link containing the report id
    expect(updates).toHaveLength(1);
    expect(updates[0]!.channel).toBe('C123');
    expect(updates[0]!.ts).toBe('MSG-TS-1');
    expect(updates[0]!.text).toContain(report.id);
    expect(updates[0]!.text.toLowerCase()).toContain('report ready');

    // an operation row must exist for the report-gen job
    const opsSnap = await db.collection('operations').where('refId', '==', offerId).get();
    expect(opsSnap).toHaveLength(1);
    const opData = opsSnap[0]!.data();
    expect(opData.kind).toBe('report-gen');
    expect(opData.refId).toBe(offerId);
    expect(opData.parentConversationId).toBeNull();
    expect(opData.status).toBe('done');

    await app.close();
  });

  it('marks the offer failed and still acks 200 when the model call throws', async () => {
    const { convo, offerId } = await seedGeneratingOffer('billing-svc');
    const { app, updates } = buildHarness({ model: { complete: async () => { throw new Error('vertex 500'); } } });
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-report', headers: { authorization: 'Bearer ok' }, payload: pushBody(offerId) });
    expect(res.statusCode).toBe(200);

    const reports = await listReportsForConversation(db, convo.id);
    expect(reports).toHaveLength(0);
    const offer = await getReportOffer(db, offerId);
    expect(offer?.status).toBe('failed');
    expect(offer?.error).toContain('vertex 500');
    expect(updates[0]!.text.toLowerCase()).toContain('failed');

    // the operation must be finished with status 'failed' and an error recorded
    const opsSnap = await db.collection('operations').where('refId', '==', offerId).get();
    expect(opsSnap).toHaveLength(1);
    const opData = opsSnap[0]!.data();
    expect(opData.kind).toBe('report-gen');
    expect(opData.status).toBe('failed');
    expect(opData.error).toContain('vertex 500');

    await app.close();
  });

  it('is idempotent: an offer not in `generating` status produces no report and acks 200', async () => {
    const project = await createProject(db, orgId, { name: 'idem-svc', slug: 'idem-svc' });
    const convo = await createConversation(db, { orgId, projectId: project.id, assistantId: null, source: 'slack' });
    const offer = await createReportOffer(db, {
      orgId, projectId: project.id, conversationId: convo.id, slackChannelId: 'C9', slackThreadTs: '1.1',
    });
    // left in 'offered' (never claimed → not generating)
    const { app } = buildHarness();
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-report', headers: { authorization: 'Bearer ok' }, payload: pushBody(offer.id) });
    expect(res.statusCode).toBe(200);
    expect(await listReportsForConversation(db, convo.id)).toHaveLength(0);
    expect((await getReportOffer(db, offer.id))?.status).toBe('offered');
    await app.close();
  });

  it('acks 200 (drop) when the offer is missing', async () => {
    const { app } = buildHarness();
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-report', headers: { authorization: 'Bearer ok' }, payload: pushBody('does-not-exist') });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('acks 200 (drop) on a malformed message', async () => {
    const { app } = buildHarness();
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-report', headers: { authorization: 'Bearer ok' }, payload: { message: { data: Buffer.from('not json').toString('base64') } } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('never returns 500 when markReportOfferFailed itself throws in the catch block (prevents redelivery/duplicate report)', async () => {
    // Arrange: a generating offer + a model that throws (entering the catch path).
    const { offerId } = await seedGeneratingOffer('failsafe-svc');
    // Make the failure-marking step itself throw — e.g. a transient Firestore error.
    // Without an inner guard in the catch block this propagates out → Fastify 500
    // → Pub/Sub redelivers → duplicate report generated.
    mockMarkReportOfferFailed.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const { app } = buildHarness({
      model: { complete: async () => { throw new Error('vertex 500'); } },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/internal/run-report',
      headers: { authorization: 'Bearer ok' }, payload: pushBody(offerId),
    });

    // The route must ALWAYS ack 200 — even when the catch block's own logic fails.
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
