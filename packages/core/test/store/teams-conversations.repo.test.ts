import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { findOrCreateTeamsConversation, getTeamsConversation, appendConversationMessage, listConversationMessages } from '../../src/repos/conversations.js';

const store = testStore('teams-conversations');
const db = store.db;
beforeEach(() => wipe(db));
afterAll(() => store.close());

const base = { orgId: 'o1', projectId: 'p1', assistantId: null, teamsTenantId: 'tn', teamsConversationId: '19:c' };

describe('teams conversations (Firestore)', () => {
  it('find-or-create is idempotent per (tenant, conversation)', async () => {
    const a = await findOrCreateTeamsConversation(db, base);
    const b = await findOrCreateTeamsConversation(db, base);
    expect(a.id).toBe(b.id);
    expect(a.source).toBe('teams');
    expect((await getTeamsConversation(db, 'tn', '19:c'))?.id).toBe(a.id);
  });

  it('appends messages with teamsUserId and seq order', async () => {
    const c = await findOrCreateTeamsConversation(db, base);
    await appendConversationMessage(db, { conversationId: c.id, role: 'user', content: 'hi', teamsUserId: '29:u' });
    await appendConversationMessage(db, { conversationId: c.id, role: 'assistant', content: 'yo' });
    const msgs = await listConversationMessages(db, c.id);
    expect(msgs.map((m) => m.content)).toEqual(['hi', 'yo']);
    expect(msgs[0]!.teamsUserId).toBe('29:u');
  });
});
