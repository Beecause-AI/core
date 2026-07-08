import { afterAll, beforeEach, expect, it } from 'vitest';
import { testStore, wipe } from '../store/emulator.js';
import { createConversation } from '../../src/repos/conversations.js';

const store = testStore('conv-repo');
const db = store.db;
beforeEach(() => wipe(db));
afterAll(() => store.close());

it('persists systemAgentKey when provided', async () => {
  const c = await createConversation(db, { orgId: 'o', projectId: 'p', assistantId: null, systemAgentKey: 'hindsight' });
  expect(c.systemAgentKey).toBe('hindsight');
});

it('defaults systemAgentKey to null', async () => {
  const c = await createConversation(db, { orgId: 'o', projectId: 'p', assistantId: 'a' });
  expect(c.systemAgentKey).toBeNull();
});
