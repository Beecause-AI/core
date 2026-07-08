import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  createTrace, addTraceStep, finalizeTrace, listTraceSteps, getTrace,
  listTracesByConversationId, startTraceStep, finishTraceStep,
} from '../../src/repos/traces.js';

const store = testStore('traces');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const orgId = 'org-1';

describe('createTrace', () => {
  it('creates a trace with status running and defaults', async () => {
    const trace = await createTrace(db, { orgId, conversationId: null, turnId: null, source: 'slack' });
    expect(trace.id).toBeTruthy();
    expect(trace.status).toBe('running');
    expect(trace.orgId).toBe(orgId);
    expect(trace.source).toBe('slack');
    expect(trace.totalInputTokens).toBe(0);
    expect(trace.totalCostUsd).toBe('0');
    expect(trace.startedAt).toBeInstanceOf(Date);
    expect(trace.endedAt).toBeNull();
  });
});

describe('addTraceStep', () => {
  it('inserts a step and listTraceSteps returns it; numeric cost as string', async () => {
    const trace = await createTrace(db, { orgId, source: 'slack' });
    const now = new Date();
    const step = await addTraceStep(db, {
      traceId: trace.id, type: 'model_call', name: 'gemini-x', status: 'ok',
      startedAt: now, endedAt: now, latencyMs: 10, inputTokens: 3, outputTokens: 2, costUsd: 0.0001,
    });
    expect(step.id).toBeTruthy();
    expect(step.traceId).toBe(trace.id);
    expect(step.type).toBe('model_call');

    const steps = await listTraceSteps(db, trace.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.name).toBe('gemini-x');
    expect(steps[0]!.inputTokens).toBe(3);
    expect(steps[0]!.costUsd).toBe('0.000100');
  });

  it('round-trips preview + childConversationId and defaults them to null', async () => {
    const trace = await createTrace(db, { orgId, source: 'slack' });
    const childConvId = randomUUID();
    const now = new Date();
    await addTraceStep(db, {
      traceId: trace.id, type: 'tool_call', name: 'read_file', status: 'ok',
      startedAt: now, endedAt: now, latencyMs: 5,
      argsPreview: '{"path":"/foo"}', resultPreview: 'file contents…', childConversationId: childConvId,
    });
    const withPreview = (await listTraceSteps(db, trace.id))[0]!;
    expect(withPreview.argsPreview).toBe('{"path":"/foo"}');
    expect(withPreview.resultPreview).toBe('file contents…');
    expect(withPreview.childConversationId).toBe(childConvId);

    const trace2 = await createTrace(db, { orgId, source: 'slack' });
    const bare = await addTraceStep(db, {
      traceId: trace2.id, type: 'model_call', name: 'gemini', status: 'ok',
      startedAt: now, endedAt: now, latencyMs: 10,
    });
    expect(bare.argsPreview).toBeNull();
    expect(bare.resultPreview).toBeNull();
    expect(bare.childConversationId).toBeNull();
  });
});

describe('start/finishTraceStep', () => {
  it('starts a running step then finishes it', async () => {
    const trace = await createTrace(db, { orgId, source: 'slack' });
    const id = await startTraceStep(db, { traceId: trace.id, type: 'tool_call', name: 'grep', startedAt: new Date() });
    expect(id).toBeTruthy();
    const running = (await listTraceSteps(db, trace.id))[0]!;
    expect(running.status).toBe('running');

    await finishTraceStep(db, id!, { status: 'ok', endedAt: new Date(), latencyMs: 7, costUsd: 0.002 });
    const done = (await listTraceSteps(db, trace.id))[0]!;
    expect(done.status).toBe('ok');
    expect(done.latencyMs).toBe(7);
    expect(done.costUsd).toBe('0.002000');
  });
});

describe('finalizeTrace', () => {
  it('updates rollup data and getTrace returns finalised state', async () => {
    const trace = await createTrace(db, { orgId, conversationId: null, turnId: null, source: 'slack' });
    await finalizeTrace(db, trace.id, {
      status: 'ok', endedAt: new Date(), totalInputTokens: 3, totalOutputTokens: 2,
      totalCostUsd: 0.0001, modelCallCount: 1, toolCallCount: 0, otelTraceId: 'abc123',
    });
    const updated = await getTrace(db, trace.id);
    expect(updated!.status).toBe('ok');
    expect(updated!.totalInputTokens).toBe(3);
    expect(updated!.totalCostUsd).toBe('0.000100');
    expect(updated!.modelCallCount).toBe(1);
    expect(updated!.otelTraceId).toBe('abc123');
  });
});

describe('getTrace', () => {
  it('returns undefined for a missing id', async () => {
    expect(await getTrace(db, 'nope')).toBeUndefined();
  });
});

describe('listTracesByConversationId', () => {
  it('returns traces for a conversation ordered by startedAt asc', async () => {
    const convId = randomUUID();
    const t1 = await createTrace(db, { orgId, conversationId: convId, source: 'slack' });
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await createTrace(db, { orgId, conversationId: convId, source: 'slack' });
    await createTrace(db, { orgId, conversationId: randomUUID(), source: 'slack' });

    const traces = await listTracesByConversationId(db, convId);
    const ids = traces.map((tr) => tr.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(t1.id);
    expect(ids[1]).toBe(t2.id);
  });
});
