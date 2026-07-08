import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import {
  addTeamMemory,
  addPrivateMemory,
  listMemories,
  listPrivateMemories,
  deleteMemory,
  deletePrivateMemory,
  recallMemories,
} from '../../src/repos/agent-memories.js';

const store = testStore('agent-memories');
const db = store.db;

beforeEach(async () => {
  await wipe(db);
  (store.vector as any).pts?.clear?.();
});
afterAll(() => store.close());

// simple orthogonal-ish embeddings so cosine ranking is deterministic
const E = (a: number, b: number) => [a, b, 0];

describe('agent-memories repo (Firestore + vector index)', () => {
  it('adds team + private memories and lists them', async () => {
    await addTeamMemory(store, { orgId: 'o', projectId: 'p', content: 'team-fact', embedding: E(1, 0) });
    await addPrivateMemory(store, { orgId: 'o', projectId: 'p', assistantId: 'a1', content: 'priv-fact', embedding: E(0, 1) });
    expect((await listMemories(db, { projectId: 'p' })).map((m) => m.content).sort()).toEqual(['priv-fact', 'team-fact']);
    expect((await listMemories(db, { projectId: 'p', scope: 'team' })).map((m) => m.content)).toEqual(['team-fact']);
    expect((await listPrivateMemories(db, { projectId: 'p', assistantId: 'a1' })).map((m) => m.content)).toEqual(['priv-fact']);
  });

  it('recall returns nearest across team ∪ own-private, scoped, and tracks usage', async () => {
    await addTeamMemory(store, { orgId: 'o', projectId: 'p', content: 'team-near', embedding: E(1, 0) });
    await addPrivateMemory(store, { orgId: 'o', projectId: 'p', assistantId: 'a1', content: 'mine', embedding: E(0.9, 0.1) });
    await addPrivateMemory(store, { orgId: 'o', projectId: 'p', assistantId: 'other', content: 'not-mine', embedding: E(1, 0) });

    const hits = await recallMemories(store, { orgId: 'o', projectId: 'p', assistantId: 'a1', queryEmbedding: E(1, 0), limit: 5 });
    const contents = hits.map((h) => h.content);
    expect(contents).toContain('team-near');
    expect(contents).toContain('mine');
    expect(contents).not.toContain('not-mine'); // another assistant's private memory is excluded
    expect(hits.every((h) => h.usageCount === 1)).toBe(true);
  });

  it('lazy-decays a stale, never-used memory on recall (Firestore + vector)', async () => {
    // seed a stale doc directly (createdAt 200 days ago, usageCount 0)
    const ref = col(db, 'agent_memories').doc();
    const old = new Date(Date.now() - 200 * 86_400_000);
    await ref.set({
      id: ref.id, orgId: 'o', projectId: 'p', assistantId: null, scope: 'team',
      content: 'stale', embedding: E(1, 0), usageCount: 0, lastRecalledAt: null, createdAt: old,
    });
    await store.vector.upsert([{ id: ref.id, embedding: E(1, 0), restricts: { orgId: 'o', projectId: 'p', scope: 'team' } }]);

    const hits = await recallMemories(store, { orgId: 'o', projectId: 'p', assistantId: 'a1', queryEmbedding: E(1, 0), limit: 5 });
    expect(hits.find((h) => h.content === 'stale')).toBeUndefined(); // decayed out of results
    expect((await ref.get()).exists).toBe(false); // hard-deleted from Firestore
  });

  it('deleteMemory / deletePrivateMemory enforce scope and clear the vector', async () => {
    const team = await addTeamMemory(store, { orgId: 'o', projectId: 'p', content: 't', embedding: E(1, 0) });
    expect(await deleteMemory(store, 'wrong-project', team.id)).toBe(false);
    expect(await deleteMemory(store, 'p', team.id)).toBe(true);

    const priv = await addPrivateMemory(store, { orgId: 'o', projectId: 'p', assistantId: 'a1', content: 'x', embedding: E(0, 1) });
    expect(await deletePrivateMemory(store, { projectId: 'p', assistantId: 'other', id: priv.id })).toBe(false);
    expect(await deletePrivateMemory(store, { projectId: 'p', assistantId: 'a1', id: priv.id })).toBe(true);
  });
});
