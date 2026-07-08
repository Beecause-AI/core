import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner } from '../src/repos/orgs.js';
import { createProject } from '../src/repos/projects.js';
import { createAssistant } from '../src/repos/assistants.js';
import {
  findOrCreateSlackConversation,
  appendConversationMessage,
  listConversationMessages,
} from '../src/repos/conversations.js';

const t = testStore('slack-conversations');
let orgId: string;
let projectId: string;
let assistantId: string;

beforeAll(async () => {
  const userId = randomUUID();
  const org = await createOrgWithOwner(t.db, { name: 'Conv Test Org', slug: `conv-${userId.slice(0, 8)}`, userId });
  orgId = org.id;
  const project = await createProject(t.db, orgId, { name: 'Test Project', slug: 'test-project' });
  projectId = project.id;
  const assistant = await createAssistant(t.db, projectId, { name: 'Test Assistant' });
  assistantId = assistant.id;
});
afterAll(() => t.close());

describe('conversations repo', () => {
  it('find-or-create is idempotent per (channel, thread) and appends ordered messages', async () => {
    const c1 = await findOrCreateSlackConversation(t.db, { orgId, projectId, assistantId, slackChannelId: 'C1', slackThreadTs: '111.1' });
    const c2 = await findOrCreateSlackConversation(t.db, { orgId, projectId, assistantId, slackChannelId: 'C1', slackThreadTs: '111.1' });
    expect(c2.id).toBe(c1.id);

    await appendConversationMessage(t.db, { conversationId: c1.id, role: 'user', content: 'hello', slackUserId: 'U1' });
    await appendConversationMessage(t.db, { conversationId: c1.id, role: 'assistant', content: 'hi there' });
    const msgs = await listConversationMessages(t.db, c1.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([['user', 'hello'], ['assistant', 'hi there']]);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2]);
  });
});
