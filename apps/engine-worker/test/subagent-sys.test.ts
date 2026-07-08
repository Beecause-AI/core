/**
 * Tests for the agent.sys.<key> branch in makeOnSubagent.
 *
 * Uses the Firestore emulator via the shared startTestDb() harness.
 *
 * Covered cases:
 *   1. agent.sys.slack → child turn spawned with systemAgentKey='slack', no assistantId
 *   2. (Removed: hindsight-specific flag-OFF gate no longer exists; stray agent.sys.hindsight
 *      calls now fall through to "Unknown system agent" because hindsight was removed from the
 *      registry. There is no gated fast-path to test.)
 *   3. agent.sys.analysis.* — always spawns even when hindsightEnabled=false (fleet is ungated)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createAssistant,
  setOrgHindsightEnabled,
  getConversation,
  getTurn,
  type QueuedTurn,
} from '@intellilabs/core';
import { makeOnSubagent } from '../src/engine/subagent.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let db: any;
let orgId: string;
let projectId: string;
let parentAssistantId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;

  const org = await createOrgWithOwner(db, { name: 'SysAgent Org', slug: 'sysagent-org', userId: 'u1' });
  orgId = org.id;

  const project = await createProject(db, orgId, { name: 'SysAgentProject', slug: 'sysagent-project' });
  projectId = project.id;

  const parentAssistant = await createAssistant(db, projectId, {
    name: 'Orchestrator',
    persona: 'You orchestrate tasks.',
    model: 'fake-model',
    enabledTools: ['agent.sys.slack'],
  });
  parentAssistantId = parentAssistant.id;
});

afterAll(async () => { await tdb.stop(); });

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<QueuedTurn> & { payloadExtras?: Record<string, unknown> } = {}): QueuedTurn {
  const { payloadExtras = {}, ...rest } = overrides;
  return {
    id: crypto.randomUUID(),
    laneId: crypto.randomUUID(),
    orgId,
    source: 'slack',
    seq: 1,
    status: 'running',
    attempts: 0,
    cancelRequested: false,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    breakerKey: null,
    error: null,
    payload: {
      model: 'test-model',
      enabledTools: ['agent.sys.slack'],
      projectId,
      assistantId: parentAssistantId,
      slack: null,
      depth: 0,
      ...payloadExtras,
    },
    ...rest,
  } as QueuedTurn;
}

const SYS_CALL = {
  id: 'c1',
  name: 'agent.sys.slack',
  arguments: { input: 'checkout is down, what should we tell the team?' },
};

// ─── slack system agent ───────────────────────────────────────────────────────

describe('makeOnSubagent — agent.sys.slack', () => {
  it('spawns a child turn with systemAgentKey=slack, assistantId=null, correct model and tools', async () => {
    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const onSubagent = makeOnSubagent(db, publish);
    const turn = makeTurn();
    const messages = [{ role: 'user' as const, content: 'checkout is down' }];
    const calls = [SYS_CALL];

    await onSubagent(turn, { messages, calls });

    // One publish call: the child turn on its own lane (NOT the parent lane)
    expect(publish).toHaveBeenCalledOnce();
    const { laneId: childLaneId, turnId: childTurnId } = published[0]!;
    expect(childLaneId).not.toBe(turn.laneId);

    // Fetch the child turn from the DB
    const childTurn = await getTurn(db, childTurnId);
    expect(childTurn).not.toBeNull();
    expect(childTurn!.laneId).toBe(childLaneId);
    expect(childTurn!.source).toBe('internal');

    const cp = childTurn!.payload as Record<string, unknown>;

    // System-agent key
    expect(cp.systemAgentKey).toBe('slack');

    // assistantId must be null (system agents have no DB row)
    expect(cp.assistantId).toBeNull();

    // Model comes from the system-agent registry (slack = gemini-3-flash-preview)
    expect(cp.model).toBe('gemini-3-flash-preview');

    // Provider must be 'platform'
    expect(cp.provider).toBe('platform');

    // enabledTools from registry (slack has no tools — its response IS the Slack message)
    expect(cp.enabledTools).toEqual([]);

    // depth incremented
    expect(cp.depth).toBe(1);

    // Messages: system persona first, then user input
    const msgs = cp.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toMatchObject({ role: 'system' });
    expect(msgs[0]!.content).toMatch(/orchestrator/i);  // from slack persona
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'checkout is down, what should we tell the team?' });

    // Parent pointers for resumeParentForChild
    expect(cp.parentCallId).toBe('c1');
    expect(cp.parentProjectId).toBe(projectId);
    expect(cp.parentAssistantId).toBe(parentAssistantId);
    expect(typeof cp.parentAgentRunId).toBe('string');

    // The child CONVERSATION row (what the thread builder reads) must carry the key too.
    const childConvo = await getConversation(db, childLaneId);
    expect(childConvo!.systemAgentKey).toBe('slack');
  });
});

// ─── analysis fleet is NOT gated by hindsight ─────────────────────────────────

describe('makeOnSubagent — agent.sys.analysis.*, hindsight OFF', () => {
  it('spawns an analysis specialist child even when hindsightEnabled=false', async () => {
    await setOrgHindsightEnabled(db, orgId, false);

    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const onSubagent = makeOnSubagent(db, publish);
    const parentLaneId = crypto.randomUUID();
    const turn = makeTurn({ laneId: parentLaneId, payloadExtras: { enabledTools: ['agent.sys.analysis.code'] } });
    const calls = [{ id: 'a1', name: 'agent.sys.analysis.code', arguments: { input: 'explore the code' } }];

    await onSubagent(turn, { messages: [{ role: 'user' as const, content: 'design the team' }], calls });

    // A child must be spawned on its OWN lane — NOT a "not available" resume on the parent lane.
    expect(publish).toHaveBeenCalledOnce();
    const { laneId: childLane, turnId: childTurnId } = published[0]!;
    expect(childLane).not.toBe(parentLaneId);

    const childTurn = await getTurn(db, childTurnId);
    const cp = childTurn!.payload as Record<string, unknown>;
    expect(cp.systemAgentKey).toBe('analysis.code');
    expect(cp.assistantId).toBeNull();
    expect(cp.model).toBe('gemini-3-flash-preview');
    expect(cp.enabledTools as string[]).toContain('integration.github.list_repos');

    expect((await getConversation(db, childLane))!.systemAgentKey).toBe('analysis.code');
  });
});
