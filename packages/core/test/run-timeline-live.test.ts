import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner } from '../src/repos/orgs.js';
import { createProject } from '../src/repos/projects.js';
import { createAssistant } from '../src/repos/assistants.js';
import { createConversation } from '../src/repos/conversations.js';
import { enqueueTurn, markTurnDone } from '../src/repos/message-queue.js';
import { createAgentRun, resolveAgentRunIfSuspended } from '../src/repos/agent-runs.js';
import { buildConversationTimeline } from '../src/telemetry/run-timeline.js';

const t = testStore('run-timeline-live');
let orgId: string, projectId: string, rootId: string, childId: string, childTurnId: string, runId: string;

beforeAll(async () => {
  const userId = randomUUID();
  const org = await createOrgWithOwner(t.db, { name: 'O', slug: `o-${userId.slice(0, 8)}`, userId });
  orgId = org.id;
  const proj = await createProject(t.db, orgId, { name: 'P', slug: 'p' });
  projectId = proj.id;
  const orch = await createAssistant(t.db, projectId, { name: 'Lead RCA Orchestrator', model: 'm' });
  // Slack root → orchestrator child (an a2a delegation).
  const root = await createConversation(t.db, { orgId, projectId, assistantId: null, source: 'slack' });
  rootId = root.id;
  const child = await createConversation(t.db, { orgId, projectId, assistantId: orch.id, source: 'internal', rootConversationId: rootId });
  childId = child.id;
  // The root is parked waiting on the child (suspended bridge); the child has a queued turn.
  // The root's own turn is already 'done' — a turn is marked done when it suspends to delegate.
  const rootTurn = await enqueueTurn(t.db, { laneId: rootId, orgId, source: 'slack', payload: {} });
  await markTurnDone(t.db, rootTurn.id);
  const run = await createAgentRun(t.db, { turnId: rootTurn.id, laneId: rootId, orgId, messages: [], pendingCalls: [], model: 'm', enabledTools: [], depth: 0 });
  runId = run.id;
  const childTurn = await enqueueTurn(t.db, { laneId: childId, orgId, source: 'internal', payload: {} });
  childTurnId = childTurn.id;
});
afterAll(() => t.close());

describe('buildConversationTimeline live state', () => {
  it('reports running with the in-flight queued turn and the suspended a2a delegation', async () => {
    const tl = await buildConversationTimeline(t.db, rootId);
    expect(tl!.status).toBe('running');
    expect(tl!.live.active).toBe(true);
    const suspended = tl!.live.pending.find((p) => p.state === 'suspended');
    expect(suspended).toMatchObject({ conversationId: rootId, depth: 0, label: 'Slack intake', detail: 'awaiting sub-agent' });
    const queued = tl!.live.pending.find((p) => p.state === 'queued');
    expect(queued).toMatchObject({ conversationId: childId, depth: 1, label: 'Lead RCA Orchestrator' });
  });

  it('reports done with no pending once turns finish and the bridge resolves', async () => {
    await markTurnDone(t.db, childTurnId);
    await resolveAgentRunIfSuspended(t.db, runId, { status: 'resolved' });
    const tl = await buildConversationTimeline(t.db, rootId);
    expect(tl!.status).toBe('done');
    expect(tl!.live.active).toBe(false);
    expect(tl!.live.pending).toEqual([]);
  });

  it('returns null (does NOT crash) for a non-existent conversation id', async () => {
    // Regression: a missing id used to yield a ghost root with projectId === undefined, which
    // crashed computeLive → listAssistants(where projectId == undefined). Now it's a clean null.
    const tl = await buildConversationTimeline(t.db, 'does-not-exist-xyz');
    expect(tl).toBeNull();
  });
});
