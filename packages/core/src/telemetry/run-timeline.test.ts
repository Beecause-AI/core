import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from '../../test/store/emulator.js';
import { createOrgWithOwner, createProject } from '../index.js';
import { createConversation } from '../repos/conversations.js';
import { startOperation, setOperationConversation } from '../repos/operations.js';
import { recordModelInvocation } from '../repos/model-invocations.js';
import { createTrace, addTraceStep } from '../repos/traces.js';
import { buildOperationTimeline, buildConversationTimeline } from './run-timeline.js';

const t = testStore('run-timeline');
let orgId: string; let projectId: string;

beforeAll(async () => {
  const org = await createOrgWithOwner(t.db, { name: 'TL', slug: 'tl-org', userId: 'u-tl-1' });
  orgId = org.id;
  projectId = (await createProject(t.db, org.id, { name: 'P', slug: 'p-tl' })).id;
});
afterAll(() => t.close());

describe('buildOperationTimeline', () => {
  it('returns model steps with full I/O + phase, oldest first', async () => {
    const op = await startOperation(t.db, { orgId, kind: 'team-autogen', projectId });
    await recordModelInvocation(t.db, {
      orgId, source: 'team-autogen:composer', model: 'm', operationId: op.id, phase: 'designing',
      messages: [{ role: 'user', content: 'hi' }], output: 'team', inputTokens: 3, outputTokens: 5,
      costUsd: '0.01', latencyMs: 12, status: 'ok',
    });
    const tl = await buildOperationTimeline(t.db, op.id);
    expect(tl!.kind).toBe('operation');
    expect(tl!.steps).toHaveLength(1);
    const s0 = tl!.steps[0]!;
    expect(s0.kind).toBe('model');
    expect(s0.phase).toBe('designing');
    expect(s0.output).toBe('team');
    expect(tl!.phases!.length).toBeGreaterThan(0);
  });
});

describe('buildConversationTimeline', () => {
  it('merges model invocations and tool steps sorted by time', async () => {
    const conv = await createConversation(t.db, { orgId, projectId, assistantId: null, source: 'incident' });
    const t1 = new Date();
    await recordModelInvocation(t.db, {
      orgId, source: 'conversation', model: 'm', conversationId: conv.id,
      messages: [{ role: 'user', content: 'q' }], output: 'calling tool', status: 'ok',
    });
    const trace = await createTrace(t.db, { orgId, conversationId: conv.id, turnId: null });
    await addTraceStep(t.db, {
      traceId: trace.id, type: 'tool_call', name: 'integration.github.get_file', status: 'ok',
      startedAt: t1, endedAt: t1, latencyMs: 4, args: '{"path":"a.ts"}', result: 'contents',
    });
    const tl = await buildConversationTimeline(t.db, conv.id);
    expect(tl!.kind).toBe('conversation');
    const kinds = tl!.steps.map((s) => s.kind);
    expect(kinds).toContain('model');
    expect(kinds).toContain('tool');
    const tool = tl!.steps.find((s) => s.kind === 'tool')!;
    expect(tool.input).toBe('{"path":"a.ts"}');
    expect(tool.output).toBe('contents');
  });
});

describe('buildOperationTimeline with linked conversation (agentic team-gen)', () => {
  it('merges the linked conversation tree tool calls into the operation timeline', async () => {
    const op = await startOperation(t.db, { orgId, kind: 'team-autogen', projectId });
    const conv = await createConversation(t.db, { orgId, projectId, assistantId: null, source: 'internal' });
    await setOperationConversation(t.db, op.id, conv.id);
    const trace = await createTrace(t.db, { orgId, conversationId: conv.id, turnId: null });
    await addTraceStep(t.db, {
      traceId: trace.id, type: 'tool_call', name: 'integration.github.search_code', status: 'ok',
      startedAt: new Date(), endedAt: new Date(), latencyMs: 7, args: '{"q":"x"}', result: 'hit',
    });
    const tl = await buildOperationTimeline(t.db, op.id);
    expect(tl!.kind).toBe('operation');
    const tool = tl!.steps.find((s) => s.kind === 'tool' && s.name === 'integration.github.search_code');
    expect(tool).toBeTruthy();
    expect(tool!.output).toBe('hit');
  });
});
