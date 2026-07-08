import { afterAll, beforeEach, expect, it } from 'vitest';
import { testStore, wipe } from '../store/emulator.js';
import { createConversation, setConversationSummary, upsertSummaryEmbedding, searchRecentSummaries } from '../../src/repos/conversations.js';

const store = testStore('recent-search');
const db = store.db;
beforeEach(() => wipe(db));
afterAll(() => store.close());

// 3-d toy embeddings: db-incident ≈ [1,0,0], billing-incident ≈ [0,1,0], query ≈ [0.9,0.1,0].
it('returns the topically nearest summary, excludes the current conversation', async () => {
  const dbInc = await createConversation(db, { orgId: 'o', projectId: 'p', assistantId: null });
  await setConversationSummary(db, dbInc.id, 'Postgres connection pool exhausted');
  await upsertSummaryEmbedding(store.vector, { conversationId: dbInc.id, orgId: 'o', projectId: 'p', embedding: [1, 0, 0] });

  const billing = await createConversation(db, { orgId: 'o', projectId: 'p', assistantId: null });
  await setConversationSummary(db, billing.id, 'Stripe webhook signature mismatch');
  await upsertSummaryEmbedding(store.vector, { conversationId: billing.id, orgId: 'o', projectId: 'p', embedding: [0, 1, 0] });

  const cur = await createConversation(db, { orgId: 'o', projectId: 'p', assistantId: null });

  const hits = await searchRecentSummaries(store, { orgId: 'o', projectId: 'p', queryEmbedding: [0.9, 0.1, 0], excludeConversationId: cur.id, limit: 5 });
  expect(hits[0]!.id).toBe(dbInc.id);
  expect(hits[0]!.summary).toBe('Postgres connection pool exhausted');
  expect(hits.find((h) => h.id === cur.id)).toBeUndefined();
});

it('scopes to the project (no cross-project leakage)', async () => {
  const a = await createConversation(db, { orgId: 'o', projectId: 'p1', assistantId: null });
  await setConversationSummary(db, a.id, 'p1 incident');
  await upsertSummaryEmbedding(store.vector, { conversationId: a.id, orgId: 'o', projectId: 'p1', embedding: [1, 0, 0] });

  const hits = await searchRecentSummaries(store, { orgId: 'o', projectId: 'p2', queryEmbedding: [1, 0, 0], limit: 5 });
  expect(hits).toHaveLength(0);
});
