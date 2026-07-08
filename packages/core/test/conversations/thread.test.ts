// packages/core/test/conversations/thread.test.ts
import { afterAll, beforeEach, expect, it } from 'vitest';
import { testStore, wipe } from '../store/emulator.js';
import { createConversation, appendConversationMessage } from '../../src/repos/conversations.js';
import { createAssistant } from '../../src/repos/assistants.js';
import { recordModelInvocation } from '../../src/repos/model-invocations.js';
import { createTrace, addTraceStep } from '../../src/repos/traces.js';
import { buildConversationThread } from '../../src/conversations/thread.js';

const store = testStore('thread');
const db = store.db;
beforeEach(() => wipe(db));
afterAll(() => store.close());

const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

it('never surfaces a system prompt — assistant text comes from output only', async () => {
  const projectId = 'p';
  const a = await createAssistant(db, projectId, { name: 'Triage', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: a.id, source: 'slack' });
  await recordModelInvocation(db, {
    source: 'conversation', model: 'm', conversationId: root.id, status: 'ok',
    messages: [{ role: 'system', content: 'SECRET-SYSTEM-PROMPT' }, { role: 'user', content: 'hi' }],
    output: 'Visible answer',
  });

  const thread = (await buildConversationThread(db, root.id))!;
  const serialized = JSON.stringify(thread);
  expect(serialized).not.toContain('SECRET-SYSTEM-PROMPT');
  expect(thread.events.some((e) => e.kind === 'message' && e.text === 'Visible answer')).toBe(true);
});

it('surfaces a user message as a human-attributed message event', async () => {
  const projectId = 'p';
  const a = await createAssistant(db, projectId, { name: 'Triage', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: a.id, source: 'slack' });
  await appendConversationMessage(db, { conversationId: root.id, role: 'user', content: 'Checkout is down' });
  const thread = (await buildConversationThread(db, root.id))!;
  const human = thread.participants.find((p) => p.role === 'human')!;
  const msg = thread.events.find((e) => e.kind === 'message' && e.text === 'Checkout is down');
  expect(msg).toBeDefined();
  expect((msg as Extract<ThreadEventForTest, { kind: 'message' }>).participantKey).toBe(human.key);
});

it('emits handover + return markers bracketing the child sub-agent work, flat', async () => {
  const projectId = 'p';
  const triage = await createAssistant(db, projectId, { name: 'Triage', persona: '', model: 'm' });
  const dbSpec = await createAssistant(db, projectId, { name: 'Database Specialist', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: triage.id, source: 'slack' });
  const child = await createConversation(db, { orgId: 'o', projectId, assistantId: dbSpec.id, source: 'internal', rootConversationId: root.id });

  // The child sub-agent's first turn carries its persona (system) + the delegation task (user).
  await recordModelInvocation(db, {
    source: 'conversation', model: 'm', conversationId: child.id, status: 'ok',
    messages: [{ role: 'system', content: 'CHILD-SECRET-PERSONA' }, { role: 'user', content: 'investigate the postgres instance' }],
    output: 'Pool maxed at 100/100',
  });
  const tr = await createTrace(db, { orgId: 'o', conversationId: root.id });
  // Mirror the real engine: the agent.* step is written on resume WITHOUT args.
  await addTraceStep(db, {
    traceId: tr.id, type: 'tool_call', name: `agent.${dbSpec.id}`, status: 'ok',
    startedAt: ahead(5_000), endedAt: ahead(5_000), latencyMs: 0,
    result: 'Pool maxed at 100/100',
    childConversationId: child.id,
  });

  const thread = (await buildConversationThread(db, root.id))!;
  const kinds = thread.events.map((e) => e.kind);
  const hi = kinds.indexOf('handover');
  const ri = kinds.indexOf('return');
  const mi = thread.events.findIndex((e) => e.kind === 'message' && e.text === 'Pool maxed at 100/100');
  expect(hi).toBeGreaterThanOrEqual(0);
  expect(hi).toBeLessThan(mi);
  expect(mi).toBeLessThan(ri);
  const handover = thread.events[hi] as Extract<ThreadEventForTest, { kind: 'handover' }>;
  // The task is recovered from the child's first USER message (the step has no args).
  expect(handover.task).toBe('investigate the postgres instance');
  expect(handover.toName).toBe('Database Specialist');
  // …and the child's system persona must NOT leak while doing so.
  expect(JSON.stringify(thread)).not.toContain('CHILD-SECRET-PERSONA');
});

it('shows the handover the moment the sub-agent is spawned, before any agent.* step (parentConversationId)', async () => {
  const projectId = 'p';
  const triage = await createAssistant(db, projectId, { name: 'Triage', persona: '', model: 'm' });
  const dbSpec = await createAssistant(db, projectId, { name: 'Database Specialist', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: triage.id, source: 'slack' });
  // Child spawned with its delegating parent recorded — but the sub-agent has NOT finished, so there
  // is NO agent.* trace step yet (the old behavior would show nothing).
  const child = await createConversation(db, { orgId: 'o', projectId, assistantId: dbSpec.id, source: 'internal', rootConversationId: root.id, parentConversationId: root.id });
  await recordModelInvocation(db, {
    source: 'conversation', model: 'm', conversationId: child.id, status: 'ok',
    messages: [{ role: 'system', content: 'CHILD-SECRET-PERSONA' }, { role: 'user', content: 'investigate the postgres instance' }],
    output: '',
  });

  const thread = (await buildConversationThread(db, root.id))!;
  const handovers = thread.events.filter((e) => e.kind === 'handover') as Extract<ThreadEventForTest, { kind: 'handover' }>[];
  expect(handovers).toHaveLength(1);
  expect(handovers[0]!.fromKey).toBe(root.id);
  expect(handovers[0]!.toName).toBe('Database Specialist');
  expect(handovers[0]!.task).toBe('investigate the postgres instance');
  // No agent.* step yet → no return marker while the child is still running.
  expect(thread.events.some((e) => e.kind === 'return')).toBe(false);
  expect(JSON.stringify(thread)).not.toContain('CHILD-SECRET-PERSONA');
});

it('renders a tool call as a tool event under the agent that ran it', async () => {
  const projectId = 'p';
  const a = await createAssistant(db, projectId, { name: 'Triage', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: a.id, source: 'slack' });
  const tr = await createTrace(db, { orgId: 'o', conversationId: root.id });
  await addTraceStep(db, {
    traceId: tr.id, type: 'tool_call', name: 'gcp.logging.query', status: 'ok',
    startedAt: new Date(), endedAt: new Date(), latencyMs: 1200,
    args: 'severity>=ERROR', result: '312 matches',
  });
  const thread = (await buildConversationThread(db, root.id))!;
  const tool = thread.events.find((e) => e.kind === 'tool');
  expect(tool).toBeDefined();
  expect((tool as Extract<ThreadEventForTest, { kind: 'tool' }>).name).toBe('gcp.logging.query');
  expect((tool as Extract<ThreadEventForTest, { kind: 'tool' }>).output).toBe('312 matches');
});

it('sums whole-tree token + cost totals across the tree', async () => {
  const projectId = 'p';
  const a = await createAssistant(db, projectId, { name: 'Triage', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: a.id, source: 'slack' });
  const child = await createConversation(db, { orgId: 'o', projectId, assistantId: a.id, source: 'internal', rootConversationId: root.id });
  await recordModelInvocation(db, { source: 'conversation', model: 'm', conversationId: root.id, status: 'ok', output: 'hi', inputTokens: 100, outputTokens: 40, costUsd: '0.002000' });
  await recordModelInvocation(db, { source: 'conversation', model: 'm', conversationId: child.id, status: 'ok', output: 'sub', inputTokens: 50, outputTokens: 10, costUsd: '0.001000' });

  const thread = (await buildConversationThread(db, root.id))!;
  expect(thread.totals.inputTokens).toBe(150);
  expect(thread.totals.outputTokens).toBe(50);
  expect(Number(thread.totals.costUsd)).toBeCloseTo(0.003, 6);
});

it('falls back to a generic name for a deleted/unknown assistant', async () => {
  const projectId = 'p';
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: 'ghost-assistant', source: 'slack' });
  await recordModelInvocation(db, { source: 'conversation', model: 'm', conversationId: root.id, status: 'ok', output: 'hi' });
  const thread = (await buildConversationThread(db, root.id))!;
  const p = thread.participants.find((x) => x.key === root.id)!;
  expect(p.name).toBe('assistant');
});

it('names a system-agent participant from its systemAgentKey (Slack)', async () => {
  const projectId = 'p';
  const a = await createAssistant(db, projectId, { name: 'Lead', persona: '', model: 'm' });
  const root = await createConversation(db, { orgId: 'o', projectId, assistantId: a.id, source: 'slack' });
  const sa = await createConversation(db, { orgId: 'o', projectId, assistantId: null, source: 'internal', rootConversationId: root.id, systemAgentKey: 'slack' });
  await recordModelInvocation(db, {
    source: 'conversation', model: 'm', conversationId: sa.id, status: 'ok',
    messages: [{ role: 'user', content: 'checkout is down' }],
    output: 'We are investigating the checkout issue.',
  });

  const thread = (await buildConversationThread(db, root.id))!;
  const p = thread.participants.find((x) => x.key === sa.id)!;
  // Name resolves via getSystemAgent('slack').name from the registry
  expect(p.name).toBe('Slack Intake');
});

// local alias so the test file can name the union without importing it everywhere
type ThreadEventForTest = import('../../src/conversations/thread.js').ThreadEvent;
