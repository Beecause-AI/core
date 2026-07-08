import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner } from '../src/repos/orgs.js';
import { createProject } from '../src/repos/projects.js';
import { createAssistant } from '../src/repos/assistants.js';
import { createConversation, listRootConversations, getConversationTree, incidentRollup } from '../src/repos/conversations.js';
import { recordModelInvocation } from '../src/repos/model-invocations.js';

const t = testStore('activity-rollup');
let orgId: string; let projectId: string; let assistantId: string;

beforeAll(async () => {
  const userId = randomUUID();
  const org = await createOrgWithOwner(t.db, { name: 'Roll Org', slug: `roll-${userId.slice(0, 8)}`, userId });
  orgId = org.id;
  const p = await createProject(t.db, orgId, { name: 'P', slug: `roll-p-${userId.slice(0, 8)}` });
  projectId = p.id;
  assistantId = (await createAssistant(t.db, projectId, { name: 'Lead' })).id;
});
afterAll(() => t.close());

describe('incident rollup + tree', () => {
  it('rolls cost across the root and its sub-agent children', async () => {
    const root = await createConversation(t.db, { orgId, projectId, assistantId });
    const child = await createConversation(t.db, { orgId, projectId, assistantId, rootConversationId: root.id });
    await recordModelInvocation(t.db, { orgId, source: 'conversation', model: 'm', conversationId: root.id, status: 'ok', costUsd: '0.100000', inputTokens: 10, outputTokens: 5 });
    await recordModelInvocation(t.db, { orgId, source: 'conversation', model: 'm', conversationId: child.id, status: 'ok', costUsd: '0.080000', inputTokens: 8, outputTokens: 4 });

    const roll = await incidentRollup(t.db, root.id);
    expect(roll.callCount).toBe(2);
    expect(Number(roll.costUsd)).toBeCloseTo(0.18, 5);

    const roots = await listRootConversations(t.db, { limit: 10 });
    expect(roots.find((r) => r.id === root.id)).toBeTruthy();
    expect(roots.find((r) => r.id === child.id)).toBeUndefined(); // children are not top-level

    const tree = await getConversationTree(t.db, root.id);
    expect(tree.root?.id).toBe(root.id);
    expect(tree.children.map((c) => c.id)).toEqual([child.id]);
  });

  it('counts rate-limited invocations across the tree (every attempt, not just give-ups)', async () => {
    const root = await createConversation(t.db, { orgId, projectId, assistantId });
    const child = await createConversation(t.db, { orgId, projectId, assistantId, rootConversationId: root.id });
    await recordModelInvocation(t.db, { orgId, source: 'conversation', model: 'm', conversationId: root.id, status: 'ok', costUsd: '0.10', inputTokens: 1, outputTokens: 1 });
    // Two 429-failed attempts on the child sub-agent.
    await recordModelInvocation(t.db, { orgId, source: 'conversation', model: 'm', conversationId: child.id, status: 'error', error: 'anthropic 429', rateLimited: true, inputTokens: 0, outputTokens: 0 });
    await recordModelInvocation(t.db, { orgId, source: 'conversation', model: 'm', conversationId: child.id, status: 'error', error: 'anthropic 429', rateLimited: true, inputTokens: 0, outputTokens: 0 });

    const roll = await incidentRollup(t.db, root.id);
    expect(roll.rateLimitedCount).toBe(2);
  });
});
