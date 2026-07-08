import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, enqueueTurn, getTurn, createAgentRun, getAgentRun, requeueTurn } from '@intellilabs/core';
import { inMemoryDispatcher } from '@intellilabs/engine';
import { deadLetterRoutes } from '../src/routes/dead-letter.js';
import fastify from 'fastify';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb; let db: any; let orgId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme-dlq', userId: 'u1' });
  orgId = org.id;
});
afterAll(async () => { await tdb.stop(); });

function buildHarness(verifyResult: boolean) {
  const dispatcher = inMemoryDispatcher();
  const app = fastify();
  app.decorate('engine', { db, dispatcher } as any);
  app.register(deadLetterRoutes, { verify: async () => verifyResult });
  return { app, dispatcher };
}
const pushBody = (laneId: string) => ({ message: { data: Buffer.from(JSON.stringify({ laneId })).toString('base64') } });

describe('POST /api/internal/dead-letter', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { app } = buildHarness(false);
    const res = await app.inject({ method: 'POST', url: '/api/internal/dead-letter', headers: { authorization: 'Bearer x' }, payload: pushBody('l') });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('fails the poison turn and resumes the parent so it is not orphaned', async () => {
    const parentLane = crypto.randomUUID();
    const run = await createAgentRun(db, {
      turnId: crypto.randomUUID(), laneId: parentLane, orgId,
      messages: [{ role: 'user', content: 'orchestrate' }],
      pendingCalls: [{ id: 'c1', name: 'agent.child', arguments: {} }],
      model: 'm', enabledTools: [], slack: null, depth: 0,
    });
    const childLane = crypto.randomUUID();
    // A poison child turn left 'queued' after exhausting redelivery.
    const child = await enqueueTurn(db, {
      laneId: childLane, orgId, source: 'internal',
      payload: { model: 'm', parentAgentRunId: run.id, parentCallId: 'c1', parentProjectId: null, depth: 1 },
    });
    await requeueTurn(db, child.id, { reason: 'breaker_open' }, false); // back to 'queued', as at DLQ time

    const { app, dispatcher } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/dead-letter', headers: { authorization: 'Bearer ok' }, payload: pushBody(childLane) });

    expect(res.statusCode).toBe(200);
    expect((await getTurn(db, child.id))?.status).toBe('failed');
    const parentResume = dispatcher.published.find((p: any) => p.laneId === parentLane);
    expect(parentResume).toBeTruthy();
    const rp = (await getTurn(db, parentResume!.turnId))!.payload as Record<string, any>;
    expect(rp.subagentResults.c1).toMatch(/fail|did not complete/i);
    expect((await getAgentRun(db, run.id))!.status).toBe('resolved');
    await app.close();
  });

  it('acks (200) a lane whose turn is already terminal (idempotent redelivery)', async () => {
    const lane = crypto.randomUUID();
    const { app } = buildHarness(true);
    const res = await app.inject({ method: 'POST', url: '/api/internal/dead-letter', headers: { authorization: 'Bearer ok' }, payload: pushBody(lane) });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
