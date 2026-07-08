import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createOrgWithOwner, createProject, createAssistant, setOrgHindsightEnabled,
  createConversation, getTurn, type QueuedTurn,
} from '@intellilabs/core';
import { RECENT_SEARCH_GUIDANCE, MEMORY_RECALL_GUIDANCE } from '@intellilabs/engine';
import { makeOnSubagent } from '../src/engine/subagent.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let db: any;
let orgId: string;
let projectId: string;
let parentAssistantId: string;
let leadId: string;
let specialistId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Lead Search Org', slug: 'lead-search-org', userId: 'u1' });
  orgId = org.id;
  const project = await createProject(db, orgId, { name: 'P', slug: 'lead-search-project' });
  projectId = project.id;
  const parent = await createAssistant(db, projectId, { name: 'Slack Intake', persona: 'front door', model: 'fake-model', enabledTools: [] });
  parentAssistantId = parent.id;
  const lead = await createAssistant(db, projectId, { name: 'Orchestrator', persona: 'You lead.', model: 'fake-model', enabledTools: ['integration.github.read'], isLead: true });
  leadId = lead.id;
  const specialist = await createAssistant(db, projectId, { name: 'Memory Specialist', persona: 'You analyze.', model: 'fake-model', enabledTools: ['memory.recall'] });
  specialistId = specialist.id;
});
afterAll(async () => { await tdb.stop(); });

async function spawnChild(childId: string, rootLaneId: string): Promise<{ laneId: string; turnId: string }> {
  const published: Array<{ laneId: string; turnId: string }> = [];
  const publish = vi.fn(async (l: string, t: string) => { published.push({ laneId: l, turnId: t }); });
  const onSubagent = makeOnSubagent(db, publish);
  const call = { id: 'c1', name: `agent.${childId}`, arguments: { input: 'checkout 500s' } };
  const turn = {
    id: crypto.randomUUID(), laneId: rootLaneId, orgId, source: 'slack', seq: 1, status: 'running',
    attempts: 0, cancelRequested: false, createdAt: new Date(), startedAt: new Date(),
    finishedAt: null, breakerKey: null, error: null,
    payload: { model: 'test-model', enabledTools: [`agent.${childId}`], projectId, assistantId: parentAssistantId, slack: null, depth: 0 },
  } as QueuedTurn;
  await onSubagent(turn, { messages: [{ role: 'user', content: 'checkout 500s' }], calls: [call] });
  return published.find((p) => p.laneId !== rootLaneId)!; // the child turn, on its own lane
}

const spawnLead = (rootLaneId: string) => spawnChild(leadId, rootLaneId);

describe('lead recent.search wiring', () => {
  it('grants recent.search + injects the guidance at incident start when enabled', async () => {
    await setOrgHindsightEnabled(db, orgId, true);
    const child = await spawnLead(crypto.randomUUID());
    const cp = (await getTurn(db, child.turnId))!.payload as Record<string, unknown>;
    expect(cp.enabledTools as string[]).toContain('recent.search');
    const msgs = cp.messages as Array<{ role: string; content: string }>;
    expect(msgs.some((m) => m.role === 'system' && m.content === RECENT_SEARCH_GUIDANCE)).toBe(true);
  });

  it('omits the tool and guidance when hindsight is disabled', async () => {
    await setOrgHindsightEnabled(db, orgId, false);
    const child = await spawnLead(crypto.randomUUID());
    const cp = (await getTurn(db, child.turnId))!.payload as Record<string, unknown>;
    expect(cp.enabledTools as string[]).not.toContain('recent.search');
    const msgs = cp.messages as Array<{ role: string; content: string }>;
    expect(msgs.some((m) => m.content === RECENT_SEARCH_GUIDANCE)).toBe(false);
    await setOrgHindsightEnabled(db, orgId, true);
  });

  it('keeps the tool but omits the guidance on a follow-up (root already has children)', async () => {
    await setOrgHindsightEnabled(db, orgId, true);
    const rootLane = crypto.randomUUID();
    await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal', rootConversationId: rootLane });
    const child = await spawnLead(rootLane);
    const cp = (await getTurn(db, child.turnId))!.payload as Record<string, unknown>;
    expect(cp.enabledTools as string[]).toContain('recent.search');
    const msgs = cp.messages as Array<{ role: string; content: string }>;
    expect(msgs.some((m) => m.content === RECENT_SEARCH_GUIDANCE)).toBe(false);
  });

  it('injects memory.recall guidance for a child holding the tool, every turn (cadence always)', async () => {
    // A non-lead specialist is never at "incident start", yet always-cadence memory.recall fires.
    const child = await spawnChild(specialistId, crypto.randomUUID());
    const cp = (await getTurn(db, child.turnId))!.payload as Record<string, unknown>;
    const msgs = cp.messages as Array<{ role: string; content: string }>;
    expect(msgs.some((m) => m.role === 'system' && m.content === MEMORY_RECALL_GUIDANCE)).toBe(true);
    expect(msgs.some((m) => m.content === RECENT_SEARCH_GUIDANCE)).toBe(false);
  });
});
