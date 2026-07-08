import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import {
  recordModelInvocation, listModelInvocations, listFullModelInvocations, getModelInvocation,
} from '../../src/repos/model-invocations.js';

const store = testStore('model-invocations');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('recordModelInvocation + getModelInvocation', () => {
  it('round-trips a full row including messages (json) and output; costUsd as string', async () => {
    const msgs = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
    await recordModelInvocation(db, {
      source: 'web', model: 'gemini-3-flash', provider: 'google', messages: msgs,
      output: 'hello world', inputTokens: 10, outputTokens: 5, costUsd: '0.000042', latencyMs: 1234, status: 'ok',
    });
    const rows = await listModelInvocations(db, { source: 'web', model: 'gemini-3-flash', limit: 1 });
    expect(rows).toHaveLength(1);
    const full = await getModelInvocation(db, rows[0]!.id);
    expect(full!.messages).toEqual(msgs);
    expect(full!.output).toBe('hello world');
    expect(full!.inputTokens).toBe(10);
    expect(full!.latencyMs).toBe(1234);
    expect(full!.status).toBe('ok');
    expect(full!.truncated).toBe(false);
    // numeric cost returns as a string to preserve the old row type
    expect(typeof full!.costUsd).toBe('string');
    expect(full!.costUsd).toBe('0.000042');
  });
});

describe('costUsd is stored as a number (for the incidentRollup sum aggregate)', () => {
  it('aggregate({ sum: costUsd }) totals across rows for a conversation', async () => {
    const conversationId = 'conv-rollup';
    await recordModelInvocation(db, { source: 'web', model: 'm', conversationId, costUsd: '0.10', status: 'ok' });
    await recordModelInvocation(db, { source: 'web', model: 'm', conversationId, costUsd: '0.25', status: 'ok' });
    await recordModelInvocation(db, { source: 'web', model: 'm', conversationId, costUsd: null, status: 'ok' });

    const agg = await col(db, 'model_invocations')
      .where('conversationId', '==', conversationId)
      .aggregate({ sum: 'costUsd', count: true });
    expect(agg.sum).toBeCloseTo(0.35, 6);
    expect(agg.count).toBe(3);
  });
});

describe('recordModelInvocation best-effort (swallows errors)', () => {
  it('does NOT throw when given a deliberately invalid row', async () => {
    await expect(
      recordModelInvocation(db, { source: 'web', model: 'x', status: undefined as unknown as string }),
    ).resolves.toBeUndefined();
  });
});

describe('large payload truncation', () => {
  it('truncates output > 1 MB and sets truncated=true', async () => {
    await recordModelInvocation(db, { source: 'gb', model: 'm', output: 'x'.repeat(1_100_000), status: 'ok' });
    const rows = await listModelInvocations(db, { source: 'gb', limit: 1 });
    const full = await getModelInvocation(db, rows[0]!.id);
    expect(full!.truncated).toBe(true);
    expect(full!.output!.length).toBe(1_000_000);
  });

  it('truncates messages > 1 MB and sets truncated=true', async () => {
    await recordModelInvocation(db, {
      source: 'gb-msg', model: 'm', messages: [{ role: 'user', content: 'y'.repeat(1_100_000) }], status: 'ok',
    });
    const rows = await listModelInvocations(db, { source: 'gb-msg', limit: 1 });
    const full = await getModelInvocation(db, rows[0]!.id);
    expect(full!.truncated).toBe(true);
    expect(Array.isArray(full!.messages)).toBe(true);
    expect((full!.messages as Array<{ content: string }>)[0]!.content).toMatch(/truncated/);
  });
});

describe('listModelInvocations', () => {
  it('filters by source, paginates with before cursor, ordered desc, compact rows', async () => {
    const src1 = 'src-1';
    const src2 = 'src-2';
    const t0 = new Date('2025-01-01T00:00:00Z');
    const t1 = new Date('2025-01-01T00:01:00Z');
    const t2 = new Date('2025-01-01T00:02:00Z');
    // Write docs directly to control createdAt (the recorder stamps now()).
    await col(db, 'model_invocations').doc().set({ source: src1, model: 'm', status: 'ok', truncated: false, costUsd: null, createdAt: t0 });
    await col(db, 'model_invocations').doc().set({ source: src1, model: 'm', status: 'ok', truncated: false, costUsd: null, createdAt: t1 });
    await col(db, 'model_invocations').doc().set({ source: src2, model: 'm', status: 'ok', truncated: false, costUsd: null, createdAt: t2 });

    const src1Rows = await listModelInvocations(db, { source: src1 });
    expect(src1Rows).toHaveLength(2);
    expect(src1Rows.some((r) => r.source === src2)).toBe(false);

    const beforeT1 = await listModelInvocations(db, { source: src1, before: t1 });
    expect(beforeT1.every((r) => r.createdAt < t1)).toBe(true);
    expect(beforeT1).toHaveLength(1);

    // compact rows omit messages/output
    expect('messages' in src1Rows[0]!).toBe(false);
    expect('output' in src1Rows[0]!).toBe(false);

    // ordered createdAt desc
    expect(src1Rows[0]!.createdAt >= src1Rows[1]!.createdAt).toBe(true);
  });

  it('empty conversationIds returns nothing; conversationIds filter matches', async () => {
    await recordModelInvocation(db, { source: 's', model: 'm', conversationId: 'cv1', status: 'ok' });
    expect(await listModelInvocations(db, { conversationIds: [] })).toEqual([]);
    const rows = await listModelInvocations(db, { conversationIds: ['cv1'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.conversationId).toBe('cv1');
  });
});

describe('listFullModelInvocations', () => {
  it('returns full rows for an operation oldest-first', async () => {
    const operationId = 'op-1';
    await col(db, 'model_invocations').doc().set({ source: 's', model: 'm', operationId, status: 'ok', truncated: false, output: 'a', costUsd: null, createdAt: new Date('2025-01-01T00:00:00Z') });
    await col(db, 'model_invocations').doc().set({ source: 's', model: 'm', operationId, status: 'ok', truncated: false, output: 'b', costUsd: null, createdAt: new Date('2025-01-01T00:01:00Z') });
    const rows = await listFullModelInvocations(db, { operationId });
    expect(rows.map((r) => r.output)).toEqual(['a', 'b']);
    expect(await listFullModelInvocations(db, { conversationIds: [] })).toEqual([]);
  });
});
