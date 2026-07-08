import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, enqueueTurn, getTurn, claimNextTurn, createAgentRun, getAgentRun } from '@intellilabs/core';
import { inMemoryDispatcher, fakeProvider, ModelRegistry } from '@intellilabs/engine';
import { runTurnRoutes } from '../src/routes/run-turn.js';
import fastify from 'fastify';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb; let db: any; let orgId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme-rt', userId: 'u1' });
  orgId = org.id;
});
afterAll(async () => { await tdb.stop(); });

const GEMINI_LIKE = { model: 'fake-model', provider: 'fake', credentialSource: 'platform' as const, cancellation: 'in-flight' as const, capabilities: { tools: false, streaming: true } };

function buildHarness(verifyResult: boolean, providerScript?: any, overrides?: Partial<Record<string, any>>) {
  const dispatcher = overrides?.dispatcher ?? inMemoryDispatcher();
  const app = fastify();
  // Silence the expected 500 logs from the unexpected-throw tests.
  app.setErrorHandler((err, _req, reply) => { reply.code(500).send({ error: 'internal' }); });
  const engine = {
    db, dispatcher,
    registry: new ModelRegistry([GEMINI_LIKE]),
    providers: new Map([[ 'fake', fakeProvider('fake', providerScript ?? [{ type: 'text', delta: 'hi' }, { type: 'done', finishReason: 'stop' }]) ]]),
    credentials: { resolve: async () => ({ apiKey: 'k' }) },
    buildRequest: overrides?.buildRequest ?? ((t: any) => ({ model: t.payload.model, messages: [{ role: 'user', content: 'hi' }] })),
  };
  app.decorate('engine', engine as any);
  app.register(runTurnRoutes, { verify: async () => verifyResult });
  return { app, dispatcher };
}
function pushBody(laneId: string) {
  return { message: { data: Buffer.from(JSON.stringify({ laneId })).toString('base64') } };
}
function rndLane() {
  return crypto.randomUUID();
}

describe('POST /api/internal/run-turn', () => {
  it('rejects an unauthenticated (bad OIDC) request with 401', async () => {
    const { app } = buildHarness(false);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer x' }, payload: pushBody('lane-x') });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a request with no Authorization header with 401', async () => {
    const { app } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', payload: pushBody('lane-x') });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('runs the lane and acks (200) on a terminal outcome', async () => {
    const lane = '00000000-0000-0000-0000-0000000000a1';
    const turn = await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const { app } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(200);
    expect((await getTurn(db, turn.id))?.status).toBe('done');
    await app.close();
  });

  it('republishes the next doorbell when more turns remain queued', async () => {
    const lane = '00000000-0000-0000-0000-0000000000a2';
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const second = await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const { app, dispatcher } = buildHarness(true);
    await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(dispatcher.published).toContainEqual({ laneId: lane, turnId: second.id });
    await app.close();
  });

  it('does not republish when no more turns remain queued (terminal)', async () => {
    const lane = rndLane();
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const { app, dispatcher } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(200);
    expect(dispatcher.published).toHaveLength(0);
    await app.close();
  });

  it('acks (200) with no publish on an idle outcome (single-flight)', async () => {
    const lane = rndLane();
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    // Claim the turn first so the lane already has a running turn → runConversation returns idle.
    await claimNextTurn(db, lane);
    const { app, dispatcher } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(200);
    expect(dispatcher.published).toHaveLength(0);
    await app.close();
  });

  it('nacks (503) when the turn requeues on a temporary failure', async () => {
    const lane = '00000000-0000-0000-0000-0000000000a3';
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const { app } = buildHarness(true, [{ type: 'error', error: Object.assign(new Error('503'), { status: 503 }) }]);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('resumes the parent agent_run when a sub-agent child turn FAILS (no orphan)', async () => {
    const parentLane = rndLane();
    const run = await createAgentRun(db, {
      turnId: crypto.randomUUID(), laneId: parentLane, orgId,
      messages: [{ role: 'user', content: 'orchestrate' }],
      pendingCalls: [{ id: 'c1', name: 'agent.child', arguments: {} }],
      model: 'fake-model', enabledTools: [], slack: null, depth: 0,
    });
    const childLane = rndLane();
    const childTurn = await enqueueTurn(db, {
      laneId: childLane, orgId, source: 'internal',
      payload: { model: 'fake-model', parentAgentRunId: run.id, parentCallId: 'c1', parentProjectId: null, depth: 1 },
    });
    // A permanent provider error fails the child turn immediately (terminal, no retries).
    const { app, dispatcher } = buildHarness(true, [{ type: 'error', error: Object.assign(new Error('400'), { status: 400 }) }]);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(childLane) });

    expect(res.statusCode).toBe(200); // a terminal failure is ACKed, not nacked
    expect((await getTurn(db, childTurn.id))?.status).toBe('failed');

    // The parent must be resumed (not left suspended/orphaned) with a failure note.
    const parentResume = dispatcher.published.find((p: any) => p.laneId === parentLane);
    expect(parentResume).toBeTruthy();
    const rp = (await getTurn(db, parentResume!.turnId))!.payload as Record<string, any>;
    expect(rp.resume).toBe(true);
    expect(rp.subagentResults.c1).toMatch(/fail|did not complete/i);
    expect((await getAgentRun(db, run.id))!.status).toBe('resolved');
    await app.close();
  });

  it('acks (200, drop) a malformed message', async () => {
    const { app } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: { message: { data: Buffer.from('not json').toString('base64') } } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('acks (200, drop) an envelope whose payload is missing laneId', async () => {
    const { app } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: { message: { data: Buffer.from(JSON.stringify({})).toString('base64') } } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('nacks (500) on an UNEXPECTED throw inside runConversation (not a 200-ack-drop)', async () => {
    // buildRequest is called inside runConversation AFTER the turn is claimed; a throw there
    // is unexpected (no outcome) and must propagate uncaught to Fastify's 500 handler → nack,
    // so Pub/Sub redelivers. A 200 here would silently DROP the turn — the bug we guard against.
    const lane = rndLane();
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const { app } = buildHarness(true, undefined, { buildRequest: () => { throw new Error('boom'); } });
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('nacks (500) when dispatcher.publish rejects on a terminal-with-more-queued lane', async () => {
    // The turn already finished (done); the failure is only in publishing the next doorbell.
    // It propagates → 500 → redelivery re-drains the lane safely (the done turn is skipped).
    const lane = rndLane();
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const rejectingDispatcher = { published: [] as any[], publish: async () => { throw new Error('publish failed'); } };
    const { app } = buildHarness(true, undefined, { dispatcher: rejectingDispatcher });
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('a failed next-doorbell publish self-heals: redelivery drains the next turn', async () => {
    // Two turns queued. The first delivery runs turn A (done) but the next-doorbell publish
    // throws → 500 → Pub/Sub nacks and redelivers the lane message. The redelivered run
    // re-enters runConversation, claimNextTurn skips terminal A and claims B directly — so
    // the lane drains without ever needing A's lost doorbell. No stall.
    const lane = rndLane();
    const a = await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });
    const b = await enqueueTurn(db, { laneId: lane, orgId, source: 'internal', payload: { model: 'fake-model' } });

    // First delivery: provider succeeds (A → done), but the next-doorbell publish fails.
    const rejectingDispatcher = { published: [] as any[], publish: async () => { throw new Error('pub down'); } };
    const { app: app1 } = buildHarness(true, undefined, { dispatcher: rejectingDispatcher });
    const res1 = await app1.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res1.statusCode).toBe(500);
    expect((await getTurn(db, a.id))?.status).toBe('done');
    expect((await getTurn(db, b.id))?.status).toBe('queued');
    await app1.close();

    // Redelivery: same lane, a working dispatcher and a fresh provider. claimNextTurn skips
    // terminal A and claims queued B, draining the lane without A's lost doorbell.
    const { app: app2 } = buildHarness(true, [{ type: 'text', delta: 'hi' }, { type: 'done', finishReason: 'stop' }], { dispatcher: inMemoryDispatcher() });
    const res2 = await app2.inject({ method: 'POST', url: '/api/internal/run-turn', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res2.statusCode).toBe(200);
    expect((await getTurn(db, b.id))?.status).toBe('done');
    await app2.close();
  });
});
