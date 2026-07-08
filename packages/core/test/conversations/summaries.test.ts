// packages/core/test/conversations/summaries.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from '../store/emulator.js';
import {
  createConversation, appendConversationMessage, setConversationSummary,
  listConversationSummaries, listTreeAssistantIds,
} from '../../src/repos/conversations.js';

const store = testStore('summaries');
const db = store.db;
beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('listConversationSummaries', () => {
  it('returns roots only, excludes sub-agent children and internal conversations', async () => {
    const projectId = 'proj-1';
    const root = await createConversation(db, { orgId: 'o', projectId, assistantId: 'a-root', source: 'slack' });
    // a sub-agent child (rootConversationId set, source internal) — must NOT appear as a row
    await createConversation(db, { orgId: 'o', projectId, assistantId: 'a-spec', source: 'internal', rootConversationId: root.id });
    // an internal root (e.g. team-autogen analysis) — must NOT appear
    await createConversation(db, { orgId: 'o', projectId, assistantId: null, source: 'internal' });

    await appendConversationMessage(db, { conversationId: root.id, role: 'user', content: 'help' });

    const rows = await listConversationSummaries(db, projectId);
    expect(rows.map((r) => r.id)).toEqual([root.id]);
    expect(rows[0]!.source).toBe('slack');
  });

  it('builds title from summary and preview from the latest message', async () => {
    const projectId = 'proj-2';
    const root = await createConversation(db, { orgId: 'o', projectId, assistantId: 'a', source: 'web' });
    await appendConversationMessage(db, { conversationId: root.id, role: 'user', content: 'first' });
    await appendConversationMessage(db, { conversationId: root.id, role: 'assistant', content: 'latest answer' });
    await setConversationSummary(db, root.id, 'Checkout 500s');

    const [row] = await listConversationSummaries(db, projectId);
    expect(row!.title).toBe('Checkout 500s');
    expect(row!.preview).toBe('latest answer');
  });

  it('reports participating assistant ids (root + children) via agentCount', async () => {
    const projectId = 'proj-3';
    const root = await createConversation(db, { orgId: 'o', projectId, assistantId: 'a-root', source: 'slack' });
    await createConversation(db, { orgId: 'o', projectId, assistantId: 'a-spec', source: 'internal', rootConversationId: root.id });
    const [row] = await listConversationSummaries(db, projectId);
    expect(row!.agentCount).toBe(2); // root assistant + 1 child assistant
  });

  it('dedups an assistant that appears in both root and a child', async () => {
    const projectId = 'proj-4';
    const root = await createConversation(db, { orgId: 'o', projectId, assistantId: 'same-a', source: 'slack' });
    await createConversation(db, { orgId: 'o', projectId, assistantId: 'same-a', source: 'internal', rootConversationId: root.id });
    const ids = await listTreeAssistantIds(db, root.id);
    expect(ids).toEqual(['same-a']);
  });
});
