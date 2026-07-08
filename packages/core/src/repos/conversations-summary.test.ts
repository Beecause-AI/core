import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from '../../test/store/emulator.js';
import { createOrgWithOwner, createProject, createAssistant } from '../index.js';
import { createConversation, setConversationSummary, getConversation } from './conversations.js';

const t = testStore('conversations-summary');
let orgId: string;
let projectId: string;
let assistantId: string;

beforeAll(async () => {
  const org = await createOrgWithOwner(t.db, { name: 'SummaryOrg', slug: 'summary-org', userId: 'u-summary-1' });
  orgId = org.id;
  const proj = await createProject(t.db, org.id, { name: 'SummaryProj', slug: 'summary-proj' });
  projectId = proj.id;
  const asst = await createAssistant(t.db, proj.id, {
    name: 'SummaryBot',
    persona: '',
    model: 'gemini-3-flash-preview',
    enabledTools: [],
  });
  assistantId = asst.id;
});

afterAll(() => t.close());

describe('setConversationSummary', () => {
  it('persists the summary on the conversation row', async () => {
    const conv = await createConversation(t.db, { orgId, projectId, assistantId, source: 'internal' });

    await setConversationSummary(t.db, conv.id, 'This is the summary text.');

    // Re-select to verify persistence
    const row = await getConversation(t.db, conv.id);
    expect(row?.summary).toBe('This is the summary text.');
  });

  it('allows creating a conversation with null assistantId (system-agent conversations)', async () => {
    // After making assistantId nullable, createConversation with null should succeed
    const conv = await createConversation(t.db, { orgId, projectId, assistantId: null as unknown as string, source: 'internal' });
    expect(conv.id).toBeTruthy();
    expect(conv.assistantId).toBeNull();
  });
});
