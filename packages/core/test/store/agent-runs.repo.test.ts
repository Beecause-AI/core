import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  createAgentRun, getAgentRun, markAgentRunResolved, resolveAgentRunIfSuspended,
  recordAgentRunResult, listSuspendedRuns,
} from '../../src/repos/agent-runs.js';

const store = testStore('agent-runs');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const orgId = 'org-1';

describe('createAgentRun', () => {
  it('creates an agent run with status suspended and returns the row', async () => {
    const run = await createAgentRun(db, {
      turnId: 't1', laneId: 'l1', orgId,
      messages: [{ role: 'user', content: 'hi' }],
      pendingCalls: [{ id: 'c1', name: 'mcp.x', arguments: {} }],
      model: 'm', enabledTools: ['mcp.x'],
      slack: { channel: 'C', threadTs: '1', placeholderTs: 'p' },
    });
    expect(run.id).toBeTruthy();
    expect(run.status).toBe('suspended');
    expect(run.orgId).toBe(orgId);
    expect(run.model).toBe('m');
    expect(run.createdAt).toBeInstanceOf(Date);
    expect(run.results).toEqual({});
  });

  it('persists depth and defaults it to 0', async () => {
    const deep = await createAgentRun(db, {
      turnId: 't', laneId: 'l', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [], depth: 2,
    });
    expect((await getAgentRun(db, deep.id))!.depth).toBe(2);

    const flat = await createAgentRun(db, {
      turnId: 't', laneId: 'l', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [],
    });
    expect((await getAgentRun(db, flat.id))!.depth).toBe(0);
  });
});

describe('getAgentRun', () => {
  it('round-trips messages and pendingCalls', async () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const pendingCalls = [{ id: 'c1', name: 'mcp.x', arguments: {} }];
    const created = await createAgentRun(db, {
      turnId: 't', laneId: 'l', orgId, messages, pendingCalls, model: 'm', enabledTools: ['mcp.x'],
    });
    const fetched = await getAgentRun(db, created.id);
    expect(fetched!.messages).toEqual(messages);
    expect(fetched!.pendingCalls).toEqual(pendingCalls);
  });

  it('returns undefined for a random id', async () => {
    expect(await getAgentRun(db, 'nope')).toBeUndefined();
  });
});

describe('recordAgentRunResult', () => {
  it('accumulates per-call results additively', async () => {
    const run = await createAgentRun(db, {
      turnId: 't', laneId: 'l', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [],
    });
    await recordAgentRunResult(db, run.id, 'c1', 'r1', 'child-1');
    await recordAgentRunResult(db, run.id, 'c2', 'r2');
    const fetched = await getAgentRun(db, run.id);
    expect(fetched!.results).toEqual({
      c1: { result: 'r1', childConversationId: 'child-1' },
      c2: { result: 'r2' },
    });
  });
});

describe('listSuspendedRuns', () => {
  it('returns only suspended runs for the given lanes', async () => {
    const a = await createAgentRun(db, { turnId: 't', laneId: 'laneA', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [] });
    const b = await createAgentRun(db, { turnId: 't', laneId: 'laneB', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [] });
    await createAgentRun(db, { turnId: 't', laneId: 'laneC', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [] });
    await markAgentRunResolved(db, b.id, { status: 'resolved' }); // no longer suspended

    expect(await listSuspendedRuns(db, [])).toEqual([]);
    const found = await listSuspendedRuns(db, ['laneA', 'laneB']);
    expect(found.map((r) => r.id)).toEqual([a.id]);
  });
});

describe('resolveAgentRunIfSuspended', () => {
  it('first call transitions and returns true; second returns false (unchanged)', async () => {
    const created = await createAgentRun(db, {
      turnId: 't', laneId: 'l', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [],
    });
    expect(await resolveAgentRunIfSuspended(db, created.id, { status: 'approved', approvedBy: 'U1' })).toBe(true);
    const afterFirst = await getAgentRun(db, created.id);
    expect(afterFirst!.status).toBe('approved');
    expect(afterFirst!.approvedBy).toBe('U1');
    expect(afterFirst!.resolvedAt).not.toBeNull();

    expect(await resolveAgentRunIfSuspended(db, created.id, { status: 'denied' })).toBe(false);
    const afterSecond = await getAgentRun(db, created.id);
    expect(afterSecond!.status).toBe('approved');
    expect(afterSecond!.approvedBy).toBe('U1');
  });

  it('returns false for a missing run', async () => {
    expect(await resolveAgentRunIfSuspended(db, 'nope', { status: 'approved' })).toBe(false);
  });
});

describe('markAgentRunResolved', () => {
  it('updates status, approvedBy, resolvedAt', async () => {
    const created = await createAgentRun(db, {
      turnId: 't', laneId: 'l', orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [],
    });
    await markAgentRunResolved(db, created.id, { status: 'approved', approvedBy: 'U1' });
    const updated = await getAgentRun(db, created.id);
    expect(updated!.status).toBe('approved');
    expect(updated!.approvedBy).toBe('U1');
    expect(updated!.resolvedAt).not.toBeNull();
  });
});
