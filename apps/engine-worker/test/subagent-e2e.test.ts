/**
 * E2E integration test: full sub-agent cycle
 *
 * Parent loop suspends on agent.<childId> call
 * → engine onSubagent (makeOnSubagent) persists an agent_run + enqueues a child turn
 * → child runs its loop → internalOnEvent persists child's final text
 * → resumeParentForChild enqueues a parent resume turn with subagentResults
 * → parent loop resume-resolves the agent call with the child's text → continues to done.
 *
 * The test drives the turns via runConversation (engine) directly — three sequential runs:
 *   Run 1: parent lane → suspended (child spawned)
 *   Run 2: child lane  → done     (parent resume enqueued)
 *   Run 3: parent lane → done     (final answer using child result)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createAssistant,
  createConversation,
  enqueueTurn,
  getTurn,
  listConversationMessages,
  type QueuedTurn,
} from '@intellilabs/core';
import {
  runConversation,
  ModelRegistry,
  inMemoryDispatcher,
  fakeProvider,
  type EngineDeps,
  type ModelProvider,
  type ModelEvent,
  type ModelMessage,
} from '@intellilabs/engine';
import { makeOnSubagent, resumeParentForChild } from '../src/engine/subagent.js';
import { makeInternalOnEvent } from '../src/engine/internal-delivery.js';
import { makeAgentSource } from '../src/engine/agent-source.js';
import { startTestDb, type TestDb } from './helpers.js';

// ─── Firestore emulator setup ────────────────────────────────────────────────

let tdb: TestDb;
let db: any;
let orgId: string;
let projectId: string;
let parentAssistantId: string;
let childAssistantId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;

  const org = await createOrgWithOwner(db, { name: 'E2E Sub-agent Org', slug: 'e2e-subagent-org', userId: 'u-e2e-1' });
  orgId = org.id;

  const project = await createProject(db, orgId, { name: 'E2EProject', slug: 'e2e-project' });
  projectId = project.id;

  // Child assistant first so we have its ID when seeding the parent's enabledTools
  const childAssistant = await createAssistant(db, projectId, {
    name: 'E2E Child',
    persona: 'You are a child worker.',
    model: 'child-model',
    enabledTools: [],
  });
  childAssistantId = childAssistant.id;

  const parentAssistant = await createAssistant(db, projectId, {
    name: 'E2E Parent',
    persona: 'You are an orchestrator.',
    model: 'parent-model',
    enabledTools: [`agent.${childAssistantId}`],
  });
  parentAssistantId = parentAssistant.id;
}, 120_000);

afterAll(async () => {
  await tdb.stop();
});

// ─── Model entries for the registry ─────────────────────────────────────────

const PARENT_ENTRY = {
  model: 'parent-model',
  provider: 'fake-parent',
  credentialSource: 'platform' as const,
  cancellation: 'in-flight' as const,
  capabilities: { tools: true, streaming: true },
};

const CHILD_ENTRY = {
  model: 'child-model',
  provider: 'fake-child',
  credentialSource: 'platform' as const,
  cancellation: 'in-flight' as const,
  capabilities: { tools: false, streaming: true },
};

// ─── Fake provider factories ─────────────────────────────────────────────────

/**
 * Parent provider:
 *   Run 1 → yields tool_call for agent.<childId>, then done('tool_use')
 *   Run 2 → yields text 'Final answer using sub-agent result', then done('stop')
 */
function makeParentProvider(): ModelProvider & { runs: number } {
  let runs = 0;
  return {
    id: 'fake-parent',
    runs: 0,
    async *run() {
      runs += 1;
      (this as any).runs = runs;
      if (runs === 1) {
        yield { type: 'tool_call', call: { id: 'call-agent-e2e-1', name: `agent.${childAssistantId}`, arguments: { input: 'do the subtask' } } } as ModelEvent;
        yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
      } else {
        yield { type: 'text', delta: 'Final answer using sub-agent result' } as ModelEvent;
        yield { type: 'done', finishReason: 'stop' } as ModelEvent;
      }
    },
  };
}

/**
 * Child provider: yields text 'CHILD RESULT', then done('stop').
 */
function makeChildProvider(): ModelProvider {
  return fakeProvider('fake-child', [
    { type: 'text', delta: 'CHILD RESULT' },
    { type: 'done', finishReason: 'stop' },
  ]);
}

// ─── EngineDeps builder ──────────────────────────────────────────────────────

function buildDeps(
  parentProvider: ModelProvider,
  childProvider: ModelProvider,
  dispatcher: ReturnType<typeof inMemoryDispatcher>,
): EngineDeps {
  const registry = new ModelRegistry([PARENT_ENTRY, CHILD_ENTRY]);
  const internalOnEvent = makeInternalOnEvent(db);

  return {
    db,
    registry,
    providers: new Map<string, ModelProvider>([
      ['fake-parent', parentProvider],
      ['fake-child', childProvider],
    ]),
    credentials: { resolve: async () => ({ apiKey: 'test-key' }) },
    buildRequest: (turn: QueuedTurn) => {
      const p = turn.payload as { model: string; messages?: ModelMessage[] };
      return { model: p.model, messages: p.messages ?? [] };
    },
    onEvent: async (turn, ev) => {
      await internalOnEvent(turn, ev);
    },
    agentLoop: {
      toolsFor: (turn: QueuedTurn) => {
        const p = turn.payload as { projectId?: string; assistantId?: string };
        return makeAgentSource(db, turn.orgId, p.projectId, p.assistantId);
      },
      toolNamesFor: (turn: QueuedTurn) =>
        ((turn.payload as { enabledTools?: string[] }).enabledTools) ?? [],
    },
    onSubagent: makeOnSubagent(db, dispatcher.publish.bind(dispatcher)),
    subagentResultsFor: (turn: QueuedTurn) =>
      (turn.payload as { subagentResults?: Record<string, string> }).subagentResults,
  };
}

// ─── The e2e test ─────────────────────────────────────────────────────────────

describe('sub-agent e2e cycle: parent suspend → child run → parent resume → done', () => {
  it('drives the full 3-run cycle with fake providers and real DB + queue + lifecycle code', async () => {
    const dispatcher = inMemoryDispatcher();
    const parentProvider = makeParentProvider();
    const childProvider = makeChildProvider();
    const deps = buildDeps(parentProvider, childProvider, dispatcher);

    // ── Seed the parent lane with a turn ──────────────────────────────────
    // The parent lane must be backed by a real conversations row so that
    // makeInternalOnEvent can appendConversationMessage when the parent turn
    // eventually uses source:'internal' (run.slack is null so resume is 'internal').
    const parentConvo = await createConversation(db, {
      orgId,
      projectId,
      assistantId: parentAssistantId,
      source: 'internal',
    });
    const parentLaneId = parentConvo.id;
    const parentTurn = await enqueueTurn(db, {
      laneId: parentLaneId,
      orgId,
      source: 'internal',
      payload: {
        model: 'parent-model',
        messages: [{ role: 'user', content: 'delegate please' }],
        enabledTools: [`agent.${childAssistantId}`],
        projectId,
        assistantId: parentAssistantId,
        depth: 0,
      },
    });

    // ── Run 1: parent lane → expect 'suspended' ───────────────────────────
    const run1 = await runConversation(deps, parentLaneId);

    expect(run1.kind).toBe('suspended');
    expect((await getTurn(db, parentTurn.id))?.status).toBe('done');

    // The dispatcher should have one publish: the child turn
    expect(dispatcher.published).toHaveLength(1);
    const childPublish = dispatcher.published[0]!;
    const childLaneId = childPublish.laneId;
    const childTurnId = childPublish.turnId;

    // Verify the child turn exists and has proper payload
    const childTurn = await getTurn(db, childTurnId);
    expect(childTurn).not.toBeNull();
    expect(childTurn!.laneId).toBe(childLaneId);
    expect(childTurn!.source).toBe('internal');
    const cp = childTurn!.payload as Record<string, unknown>;
    expect(cp.model).toBe('child-model');
    expect(cp.depth).toBe(1);
    expect(cp.parentCallId).toBe('call-agent-e2e-1');
    expect(typeof cp.parentAgentRunId).toBe('string');

    // ── Run 2: child lane → expect 'done'; parent resume should be enqueued ──
    const dispatcherBeforeChild = dispatcher.published.length;

    const run2 = await runConversation(deps, childLaneId);

    expect(run2.kind).toBe('done');
    expect((await getTurn(db, childTurnId))?.status).toBe('done');

    // internalOnEvent should have persisted 'CHILD RESULT' to the child conversation
    const childMessages = await listConversationMessages(db, childLaneId);
    const lastChildMsg = childMessages.at(-1);
    expect(lastChildMsg?.role).toBe('assistant');
    expect(lastChildMsg?.content).toBe('CHILD RESULT');

    // Now call resumeParentForChild (as run-turn.ts does after a done turn)
    const finishedChildTurn = await getTurn(db, childTurnId);
    expect(finishedChildTurn).not.toBeNull();
    const resumed = await resumeParentForChild(db, dispatcher.publish.bind(dispatcher), finishedChildTurn!);
    expect(resumed).toBe(true);

    // A parent resume turn should have been enqueued on the parent lane
    expect(dispatcher.published.length).toBe(dispatcherBeforeChild + 1);
    const resumePublish = dispatcher.published[dispatcher.published.length - 1]!;
    expect(resumePublish.laneId).toBe(parentLaneId);

    const resumeTurn = await getTurn(db, resumePublish.turnId);
    expect(resumeTurn).not.toBeNull();
    const rp = resumeTurn!.payload as Record<string, unknown>;
    expect(rp.resume).toBe(true);
    expect((rp.subagentResults as Record<string, string>)['call-agent-e2e-1']).toBe('CHILD RESULT');

    // ── Run 3: parent lane resume → expect 'done' with final answer ───────
    const run3 = await runConversation(deps, parentLaneId);

    expect(run3.kind).toBe('done');

    // The parent resume turn should be done
    expect((await getTurn(db, resumePublish.turnId))?.status).toBe('done');

    // Parent provider ran twice total (run 1 suspended on subagent, run 3 produced final text)
    // The 'runs' property is mutated by our fake
    expect((parentProvider as any).runs).toBe(2);

    // The child conversation should still have 'CHILD RESULT' as the assistant message
    // (internalOnEvent doesn't touch it again)
    const childMsgsAfter = await listConversationMessages(db, childLaneId);
    const lastChildMsgAfter = childMsgsAfter.at(-1);
    expect(lastChildMsgAfter?.content).toBe('CHILD RESULT');
  }, 120_000);
});
