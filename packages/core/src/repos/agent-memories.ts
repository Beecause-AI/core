import type { Db, Store } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import { getAllDocs } from '../store/query.js';
import type { AgentMemory } from '../store/types.js';

const STALE_DAYS = 90; // not recalled (or, if never recalled, created) within this window → decay candidate

/** Vector restricts (equality tags) used to scope ANN search the way the old SQL WHERE did. */
function restrictsFor(m: { orgId: string; projectId: string; scope: 'team' | 'private'; assistantId: string | null }) {
  const r: Record<string, string> = { orgId: m.orgId, projectId: m.projectId, scope: m.scope };
  if (m.assistantId) r.assistantId = m.assistantId;
  return r;
}

async function insertMemory(
  store: Store,
  row: { orgId: string; projectId: string; assistantId: string | null; scope: 'team' | 'private'; content: string; embedding: number[] },
): Promise<AgentMemory> {
  const ref = col(store.db, 'agent_memories').doc();
  const full = applyDefaults(
    { ...row, usageCount: 0, lastRecalledAt: null as Date | null },
    ref.id,
  );
  await ref.set(toDoc(full));
  // Mirror the embedding into the vector index so recall (Vertex ANN) can find it.
  await store.vector.upsert([{ id: ref.id, embedding: row.embedding, restricts: restrictsFor(row) }]);
  return fromDoc<AgentMemory>(await ref.get());
}

export async function addTeamMemory(
  store: Store,
  input: { orgId: string; projectId: string; content: string; embedding: number[] },
): Promise<AgentMemory> {
  return insertMemory(store, { ...input, assistantId: null, scope: 'team' });
}

export async function addPrivateMemory(
  store: Store,
  input: { orgId: string; projectId: string; assistantId: string; content: string; embedding: number[] },
): Promise<AgentMemory> {
  return insertMemory(store, { ...input, scope: 'private' });
}

export async function listPrivateMemories(db: Db, input: { projectId: string; assistantId: string }): Promise<AgentMemory[]> {
  const snaps = await col(db, 'agent_memories')
    .where('projectId', '==', input.projectId)
    .where('scope', '==', 'private')
    .where('assistantId', '==', input.assistantId)
    .orderBy('createdAt', 'asc')
    .get();
  return snaps.map((d) => fromDoc<AgentMemory>(d));
}

export async function listMemories(db: Db, input: { projectId: string; scope?: 'private' | 'team' }): Promise<AgentMemory[]> {
  let q = col(db, 'agent_memories').where('projectId', '==', input.projectId);
  if (input.scope) q = q.where('scope', '==', input.scope);
  const snaps = await q.orderBy('createdAt', 'asc').get();
  return snaps.map((d) => fromDoc<AgentMemory>(d));
}

export async function deleteMemory(store: Store, projectId: string, id: string): Promise<boolean> {
  const ref = col(store.db, 'agent_memories').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== projectId) return false;
  await ref.delete();
  await store.vector.remove([id]);
  return true;
}

export async function deletePrivateMemory(
  store: Store,
  input: { projectId: string; assistantId: string; id: string },
): Promise<boolean> {
  const ref = col(store.db, 'agent_memories').doc(input.id);
  const snap = await ref.get();
  const d = snap.data();
  if (
    !snap.exists ||
    d?.projectId !== input.projectId ||
    d?.assistantId !== input.assistantId ||
    d?.scope !== 'private'
  ) {
    return false;
  }
  await ref.delete();
  await store.vector.remove([input.id]);
  return true;
}

/** Semantic recall over team(project) ∪ private(assistant), ordered by cosine distance, with
 *  usage tracking on returned rows and opportunistic (lazy) deletion of stale unused entries. */
export async function recallMemories(
  store: Store,
  input: { orgId: string; projectId: string; assistantId: string; queryEmbedding: number[]; limit?: number },
): Promise<AgentMemory[]> {
  const limit = Math.min(input.limit ?? 5, 10);
  const base = { orgId: [input.orgId], projectId: [input.projectId] };
  // (scope='team' OR assistantId=X) can't be one Vertex restrict → two filtered searches, merged.
  const [team, priv] = await Promise.all([
    store.vector.findNeighbors(input.queryEmbedding, { limit, filter: { ...base, scope: ['team'] } }),
    store.vector.findNeighbors(input.queryEmbedding, { limit, filter: { ...base, assistantId: [input.assistantId] } }),
  ]);
  const byId = new Map<string, number>();
  for (const n of [...team, ...priv]) {
    const prev = byId.get(n.id);
    if (prev === undefined || n.distance < prev) byId.set(n.id, n.distance);
  }
  const ranked = [...byId.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id]) => id);
  if (ranked.length === 0) return [];

  const snaps = await getAllDocs(store.db, 'agent_memories', ranked);
  const order = new Map(ranked.map((id, i) => [id, i]));
  const rows = snaps
    .map((s) => fromDoc<AgentMemory>(s))
    .sort((a, b) => (order.get(a.id)! - order.get(b.id)!));

  // lazy decay: hard-delete any candidate past the staleness window AND never used.
  const cutoff = Date.now() - STALE_DAYS * 86_400_000;
  const stale = rows.filter((r) => r.usageCount === 0 && (r.lastRecalledAt ?? r.createdAt).getTime() < cutoff);
  if (stale.length > 0) {
    const ids = stale.map((r) => r.id);
    await Promise.all(ids.map((id) => col(store.db, 'agent_memories').doc(id).delete()));
    await store.vector.remove(ids);
  }
  const live = rows.filter((r) => !stale.some((s) => s.id === r.id));

  // usage tracking on the survivors we return.
  if (live.length > 0) {
    await Promise.all(
      live.map((r) =>
        col(store.db, 'agent_memories').doc(r.id).update({
          usageCount: FieldValue.increment(1),
          lastRecalledAt: FieldValue.serverTimestamp(),
        }),
      ),
    );
  }
  const now = new Date();
  return live.map((r) => ({ ...r, usageCount: r.usageCount + 1, lastRecalledAt: now }));
}
