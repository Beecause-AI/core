import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createAssistant,
  createAgentRun,
  getAgentRun,
  appendConversationMessage,
  createConversation,
  enqueueTurn,
  getTurn,
  createSkill,
  setAttachedSkills,
  type QueuedTurn,
} from '@intellilabs/core';
import { makeOnSubagent, resumeParentForChild, MAX_SUBAGENT_DEPTH } from '../src/engine/subagent.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let db: any;
let orgId: string;
let projectId: string;
let parentAssistantId: string;
let childAssistantId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;

  const org = await createOrgWithOwner(db, { name: 'SubAgent Org', slug: 'subagent-org', userId: 'u1' });
  orgId = org.id;

  const project = await createProject(db, orgId, { name: 'SubagentProject', slug: 'subagent-project' });
  projectId = project.id;

  const parentAssistant = await createAssistant(db, projectId, {
    name: 'Orchestrator',
    persona: 'You orchestrate tasks.',
    model: 'fake-model',
    enabledTools: ['agent.' + 'child-placeholder'], // will be filled after child creation
  });
  parentAssistantId = parentAssistant.id;

  const childAssistant = await createAssistant(db, projectId, {
    name: 'Researcher',
    persona: 'You research things.',
    model: 'fake-child-model',
    enabledTools: [],
  });
  childAssistantId = childAssistant.id;
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
      enabledTools: [`agent.${childAssistantId}`],
      projectId,
      assistantId: parentAssistantId,
      slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.1' },
      depth: 0,
      ...payloadExtras,
    },
    ...rest,
  } as QueuedTurn;
}

// ─── spawn test ──────────────────────────────────────────────────────────────

describe('makeOnSubagent — spawn', () => {
  it('creates a parent agent_run bridge + enqueues a child turn on the child lane', async () => {
    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const onSubagent = makeOnSubagent(db, publish);
    const turn = makeTurn();
    const messages = [{ role: 'user' as const, content: 'do it' }];
    const calls = [{ id: 'c1', name: `agent.${childAssistantId}`, arguments: { input: 'research X' } }];

    await onSubagent(turn, { messages, calls });

    // publish should have been called once (the child turn)
    expect(publish).toHaveBeenCalledOnce();
    const { laneId: childLaneId, turnId: childTurnId } = published[0]!;

    // The child turn should exist in the queue
    const childTurn = await getTurn(db, childTurnId);
    expect(childTurn).not.toBeNull();
    expect(childTurn!.laneId).toBe(childLaneId);
    expect(childTurn!.source).toBe('internal');

    const cp = childTurn!.payload as Record<string, unknown>;
    expect(cp.depth).toBe(1);
    expect(cp.model).toBe('fake-child-model');
    expect(cp.parentCallId).toBe('c1');
    expect(cp.parentProjectId).toBe(projectId);
    expect(cp.parentAssistantId).toBe(parentAssistantId);
    expect(typeof cp.parentAgentRunId).toBe('string');

    // The parent agent_run should be suspended with depth 0
    const run = await getAgentRun(db, cp.parentAgentRunId as string);
    expect(run).not.toBeUndefined();
    expect(run!.status).toBe('suspended');
    expect(run!.depth).toBe(0);
    expect(run!.pendingCalls).toEqual(calls);
    expect(run!.messages).toEqual(messages);

    // The child's messages array should start with persona + user input
    const childMessages = cp.messages as Array<{ role: string; content: string }>;
    expect(childMessages[0]).toMatchObject({ role: 'system', content: 'You research things.' });
    expect(childMessages[1]).toMatchObject({ role: 'user', content: 'research X' });
  });
});

// ─── skill injection test ────────────────────────────────────────────────────

describe('makeOnSubagent — skill injection', () => {
  it('injects the ## Skills block and adds skill.load to enabledTools when the child has attached skills', async () => {
    // Create a skill and attach it to the child assistant
    const skill = await createSkill(db, {
      orgId,
      projectId,
      name: 'my-playbook',
      description: 'how to handle incidents',
      body: 'Step 1: ...',
    });
    await setAttachedSkills(db, childAssistantId, [skill.id]);

    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const onSubagent = makeOnSubagent(db, publish);
    const turn = makeTurn();
    const messages = [{ role: 'user' as const, content: 'do it' }];
    const calls = [{ id: 'skill-c1', name: `agent.${childAssistantId}`, arguments: { input: 'research Y' } }];

    await onSubagent(turn, { messages, calls });

    expect(publish).toHaveBeenCalledOnce();
    const { turnId: childTurnId } = published[0]!;
    const childTurn = await getTurn(db, childTurnId);
    expect(childTurn).not.toBeNull();

    const cp = childTurn!.payload as Record<string, unknown>;
    const childMessages = cp.messages as Array<{ role: string; content: string }>;

    // persona first, then skills block, then user input
    expect(childMessages[0]).toMatchObject({ role: 'system', content: 'You research things.' });
    expect(childMessages[1]).toMatchObject({ role: 'system' });
    expect(childMessages[1]!.content).toContain('## Skills');
    expect(childMessages[1]!.content).toContain('my-playbook: how to handle incidents');
    expect(childMessages[1]!.content).toContain('skill.load');
    expect(childMessages[2]).toMatchObject({ role: 'user', content: 'research Y' });

    // skill.load added to enabledTools
    expect(cp.enabledTools as string[]).toContain('skill.load');

    // cleanup
    await setAttachedSkills(db, childAssistantId, []);
  });

  it('does NOT inject ## Skills and does NOT add skill.load when the child has no attached skills', async () => {
    // Ensure no skills attached (cleanup from prior test)
    await setAttachedSkills(db, childAssistantId, []);

    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const onSubagent = makeOnSubagent(db, publish);
    const turn = makeTurn();
    const messages = [{ role: 'user' as const, content: 'do it' }];
    const calls = [{ id: 'noskill-c1', name: `agent.${childAssistantId}`, arguments: { input: 'research Z' } }];

    await onSubagent(turn, { messages, calls });

    expect(publish).toHaveBeenCalledOnce();
    const { turnId: childTurnId } = published[0]!;
    const childTurn = await getTurn(db, childTurnId);
    expect(childTurn).not.toBeNull();

    const cp = childTurn!.payload as Record<string, unknown>;
    const childMessages = cp.messages as Array<{ role: string; content: string }>;

    // Only persona + user input (no skills block)
    expect(childMessages).toHaveLength(2);
    expect(childMessages[0]).toMatchObject({ role: 'system', content: 'You research things.' });
    expect(childMessages[1]).toMatchObject({ role: 'user', content: 'research Z' });
    expect((cp.enabledTools as string[]).includes('skill.load')).toBe(false);
  });
});

// ─── depth cap test ──────────────────────────────────────────────────────────

describe('makeOnSubagent — depth cap', () => {
  it('does NOT spawn a child when depth == MAX_SUBAGENT_DEPTH; instead resumes the parent with error', async () => {
    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const onSubagent = makeOnSubagent(db, publish);
    // Use a real lane (must be a conversation ID) — fake it by using a new UUID for laneId
    const parentLaneId = crypto.randomUUID();
    const turn = makeTurn({
      laneId: parentLaneId,
      payloadExtras: { depth: MAX_SUBAGENT_DEPTH },
    });
    const messages = [{ role: 'user' as const, content: 'do deep thing' }];
    const calls = [{ id: 'dc1', name: `agent.${childAssistantId}`, arguments: { input: 'go deep' } }];

    await onSubagent(turn, { messages, calls });

    // No child spawned; instead a resume turn was enqueued on the PARENT lane
    expect(publish).toHaveBeenCalledOnce();
    const { laneId, turnId } = published[0]!;
    expect(laneId).toBe(parentLaneId);

    const resumeTurn = await getTurn(db, turnId);
    expect(resumeTurn).not.toBeNull();
    const rp = resumeTurn!.payload as Record<string, unknown>;
    expect(rp.resume).toBe(true);
    expect((rp.subagentResults as Record<string, string>)['dc1']).toContain('depth limit');
  });
});

// ─── resumeParentForChild test ────────────────────────────────────────────────

describe('resumeParentForChild', () => {
  it('reads child text, enqueues parent resume with subagentResults, resolves agent_run (atomic)', async () => {
    // Seed a parent agent_run (suspended)
    const parentLaneId = crypto.randomUUID();
    const parentTurnId = crypto.randomUUID();
    const run = await createAgentRun(db, {
      turnId: parentTurnId,
      laneId: parentLaneId,
      orgId,
      messages: [{ role: 'user', content: 'orchestrate' }],
      pendingCalls: [{ id: 'c1', name: `agent.${childAssistantId}`, arguments: {} }],
      model: 'test-model',
      enabledTools: [],
      slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.1' },
      depth: 0,
    });

    // Seed a child conversation with a final assistant message
    const childConvo = await createConversation(db, {
      orgId,
      projectId,
      assistantId: childAssistantId,
      source: 'internal',
    });
    await appendConversationMessage(db, {
      conversationId: childConvo.id,
      role: 'assistant',
      content: 'the answer',
    });

    // Build a fake child turn with the parent links
    const childTurn: QueuedTurn = {
      id: crypto.randomUUID(),
      laneId: childConvo.id,
      orgId,
      source: 'internal',
      seq: 1,
      status: 'done',
      attempts: 0,
      deferrals: 0,
      cancelRequested: false,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      breakerKey: null,
      error: null,
      payload: {
        model: 'fake-child-model',
        messages: [],
        enabledTools: [],
        parentAgentRunId: run.id,
        parentCallId: 'c1',
        parentProjectId: projectId,
        parentAssistantId: parentAssistantId,
        depth: 1,
      },
    };

    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    // First call: should handle the child and enqueue the parent resume
    const result = await resumeParentForChild(db, publish, childTurn);
    expect(result).toBe(true);

    expect(publish).toHaveBeenCalledOnce();
    const { laneId, turnId } = published[0]!;
    expect(laneId).toBe(parentLaneId);

    const resumeTurn = await getTurn(db, turnId);
    expect(resumeTurn).not.toBeNull();
    const rp = resumeTurn!.payload as Record<string, unknown>;
    expect(rp.resume).toBe(true);
    expect((rp.subagentResults as Record<string, string>)['c1']).toBe('the answer');
    // childConversationIds maps the spawned call id to the child lane id
    expect((rp.childConversationIds as Record<string, string>)['c1']).toBe(childConvo.id);
    // The parent resume source should be 'slack' since run.slack is set
    expect(resumeTurn!.source).toBe('slack');

    // agent_run should now be resolved
    const resolvedRun = await getAgentRun(db, run.id);
    expect(resolvedRun!.status).toBe('resolved');

    // Second call (race): should return true but NOT publish again
    const result2 = await resumeParentForChild(db, publish, childTurn);
    expect(result2).toBe(true);
    expect(publish).toHaveBeenCalledOnce(); // still only once
  });

  it('resumes the parent with a failure note when the child turn FAILED (no orphan)', async () => {
    const parentLaneId = crypto.randomUUID();
    const run = await createAgentRun(db, {
      turnId: crypto.randomUUID(), laneId: parentLaneId, orgId,
      messages: [{ role: 'user', content: 'orchestrate' }],
      pendingCalls: [{ id: 'c1', name: `agent.${childAssistantId}`, arguments: {} }],
      model: 'test-model', enabledTools: [],
      slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.1' }, depth: 0,
    });
    // Child conversation with NO assistant message — it died (e.g. a rate-limit give-up).
    const childConvo = await createConversation(db, { orgId, projectId, assistantId: childAssistantId, source: 'internal' });

    const childTurn: QueuedTurn = {
      id: crypto.randomUUID(), laneId: childConvo.id, orgId, source: 'internal', seq: 1,
      status: 'failed', attempts: 5, deferrals: 0, cancelRequested: false,
      createdAt: new Date(), startedAt: new Date(), finishedAt: new Date(),
      breakerKey: null, error: { reason: 'breaker_open_exhausted' },
      payload: {
        model: 'fake-child-model', messages: [], enabledTools: [],
        parentAgentRunId: run.id, parentCallId: 'c1', parentProjectId: projectId,
        parentAssistantId: parentAssistantId, depth: 1,
      },
    };

    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    const result = await resumeParentForChild(db, publish, childTurn);
    expect(result).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
    expect(published[0]!.laneId).toBe(parentLaneId);

    const resumeTurn = await getTurn(db, published[0]!.turnId);
    const rp = resumeTurn!.payload as Record<string, unknown>;
    expect(rp.resume).toBe(true);
    // The parent is resumed with a failure note (NOT silently dropped, NOT '(no response)').
    expect((rp.subagentResults as Record<string, string>)['c1']).toMatch(/fail|did not complete/i);

    expect((await getAgentRun(db, run.id))!.status).toBe('resolved');
  });

  it('returns false for a turn without parentAgentRunId', async () => {
    const published: Array<unknown> = [];
    const publish = vi.fn(async (l: string, t: string) => { published.push({ l, t }); });

    const plainTurn: QueuedTurn = {
      id: crypto.randomUUID(),
      laneId: crypto.randomUUID(),
      orgId,
      source: 'slack',
      seq: 1,
      status: 'done',
      attempts: 0,
      deferrals: 0,
      cancelRequested: false,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      breakerKey: null,
      error: null,
      payload: { model: 'm', messages: [] },
    };

    const result = await resumeParentForChild(db, publish, plainTurn);
    expect(result).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});

// ─── sequential fan-out over multiple delegations ─────────────────────────────

describe('makeOnSubagent — multiple delegations in one batch', () => {
  it('runs each delegation in turn and resumes the parent ONCE with all results (no "one per step")', async () => {
    const childB = await createAssistant(db, projectId, { name: 'Analyst', persona: 'You analyse.', model: 'fake-b', enabledTools: [] });
    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });
    const onSubagent = makeOnSubagent(db, publish);
    const turn = makeTurn({ payloadExtras: { enabledTools: [`agent.${childAssistantId}`, `agent.${childB.id}`] } });
    const parentLane = turn.laneId;
    const messages = [{ role: 'user' as const, content: 'orchestrate' }];
    const calls = [
      { id: 'c1', name: `agent.${childAssistantId}`, arguments: { input: 'task A' } },
      { id: 'c2', name: `agent.${childB.id}`, arguments: { input: 'task B' } },
    ];

    await onSubagent(turn, { messages, calls });
    // Only the FIRST delegation spawned; the parent is NOT resumed yet.
    expect(published).toHaveLength(1);
    const aTurn = (await getTurn(db, published[0]!.turnId))!;
    expect((aTurn.payload as Record<string, unknown>).parentCallId).toBe('c1');

    // A finishes → the SECOND delegation spawns; still no parent resume.
    await appendConversationMessage(db, { conversationId: aTurn.laneId, role: 'assistant', content: 'answer A' });
    await resumeParentForChild(db, publish, aTurn);
    expect(published).toHaveLength(2);
    const bTurn = (await getTurn(db, published[1]!.turnId))!;
    expect((bTurn.payload as Record<string, unknown>).parentCallId).toBe('c2');
    expect(published[1]!.laneId).not.toBe(parentLane);

    // B finishes → the parent resumes ONCE with BOTH real results.
    await appendConversationMessage(db, { conversationId: bTurn.laneId, role: 'assistant', content: 'answer B' });
    await resumeParentForChild(db, publish, bTurn);
    expect(published).toHaveLength(3);
    expect(published[2]!.laneId).toBe(parentLane);
    const rp = (await getTurn(db, published[2]!.turnId))!.payload as Record<string, unknown>;
    expect(rp.resume).toBe(true);
    expect(rp.subagentResults).toEqual({ c1: 'answer A', c2: 'answer B' });
    expect((rp.childConversationIds as Record<string, string>).c1).toBe(aTurn.laneId);
    expect((rp.childConversationIds as Record<string, string>).c2).toBe(bTurn.laneId);
    expect(JSON.stringify(rp.subagentResults)).not.toContain('Only one sub-agent');
  });
});

// ─── resume carries orchestrator context (the team.submit_proposal "unknown tool" bug) ───────────
describe('resumeParentForChild — carries orchestrator context', () => {
  it('carries proposalId/systemAgentKey/operationId from the suspended orchestrator turn into the resume', async () => {
    // The analysis orchestrator delegates, then submits on a RESUMED turn. bootstrap.ts gates
    // team.submit_proposal on payload.proposalId — if the resume drops it, submit becomes
    // "unknown tool". This guards that the resume preserves the orchestrator's context.
    const parentConvo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal' });
    const parentLane = parentConvo.id;
    const parentTurn = await enqueueTurn(db, {
      laneId: parentLane,
      orgId,
      source: 'api',
      payload: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'design the team' }],
        enabledTools: ['agent.sys.analysis.code', 'team.submit_proposal'],
        proposalId: 'PROP-1',
        systemAgentKey: 'analysis.orchestrator',
        operationId: 'OP-1',
        rootConversationId: parentLane,
        projectId,
        assistantId: null,
        depth: 0,
      },
    });
    const run = await createAgentRun(db, {
      turnId: parentTurn.id,
      laneId: parentLane,
      orgId,
      messages: [{ role: 'user', content: 'design the team' }],
      pendingCalls: [{ id: 'c1', name: 'agent.sys.analysis.code', arguments: { input: 'explore' } }],
      model: 'test-model',
      enabledTools: ['agent.sys.analysis.code', 'team.submit_proposal'],
      slack: null,
      depth: 0,
    });
    const childConvo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal', rootConversationId: parentLane });
    await appendConversationMessage(db, { conversationId: childConvo.id, role: 'assistant', content: 'found components' });

    const childTurn: QueuedTurn = {
      id: crypto.randomUUID(), laneId: childConvo.id, orgId, source: 'internal', seq: 1,
      status: 'done', attempts: 0, deferrals: 0, cancelRequested: false,
      createdAt: new Date(), startedAt: new Date(), finishedAt: new Date(),
      breakerKey: null, error: null,
      payload: {
        model: 'fake-child-model', messages: [], enabledTools: [],
        parentAgentRunId: run.id, parentCallId: 'c1', parentProjectId: projectId,
        parentAssistantId: null, depth: 1, rootConversationId: parentLane,
      },
    } as QueuedTurn;

    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });

    await resumeParentForChild(db, publish, childTurn);
    expect(publish).toHaveBeenCalledOnce();

    const resume = await getTurn(db, published[0]!.turnId);
    const rp = resume!.payload as Record<string, unknown>;
    expect(rp.resume).toBe(true);
    expect(rp.proposalId).toBe('PROP-1');
    expect(rp.systemAgentKey).toBe('analysis.orchestrator');
    expect(rp.operationId).toBe('OP-1');
  });
});

// ─── analysis-fleet delegation cap (backstop against runaway over-delegation) ─────────────────────
describe('makeOnSubagent — analysis delegation cap', () => {
  it('refuses to spawn more analysis specialists past the cap and tells the orchestrator to submit', async () => {
    const rootConvo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal' });
    // Seed the cap's worth of prior delegations (children under the root).
    for (let i = 0; i < 8; i++) {
      await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal', rootConversationId: rootConvo.id });
    }
    const published: Array<{ laneId: string; turnId: string }> = [];
    const publish = vi.fn(async (laneId: string, turnId: string) => { published.push({ laneId, turnId }); });
    const onSubagent = makeOnSubagent(db, publish);
    const turn = makeTurn({ laneId: rootConvo.id, payloadExtras: { enabledTools: ['agent.sys.analysis.code'], rootConversationId: rootConvo.id } });
    const calls = [{ id: 'over', name: 'agent.sys.analysis.code', arguments: { input: 'explore' } }];

    await onSubagent(turn, { messages: [{ role: 'user' as const, content: 'design' }], calls });

    // Capped → no new child spawned; the parent is resumed on its OWN lane with a "submit now" note.
    expect(publish).toHaveBeenCalledOnce();
    expect(published[0]!.laneId).toBe(rootConvo.id);
    const resume = await getTurn(db, published[0]!.turnId);
    const rp = resume!.payload as Record<string, unknown>;
    expect((rp.subagentResults as Record<string, string>).over).toMatch(/cap|submit/i);
  });
});
