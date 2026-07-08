import type { DocStore, Snapshot } from '../ports/store.js';
import { col, type CollectionName } from './collections.js';

/** Split an array into fixed-size chunks. Firestore caps `in`/`not-in` filters at 30
 *  values and `getAll` is most efficient batched; callers chunk accordingly. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Batched `getAll` by document id, preserving existence (missing docs are dropped).
 *  Replaces `inArray(t.id, ids)` selects. Order is NOT guaranteed — sort at the call site. */
export async function getAllDocs(
  db: DocStore,
  collection: CollectionName,
  ids: string[],
): Promise<Snapshot[]> {
  if (ids.length === 0) return [];
  const c = col(db, collection);
  const out: Snapshot[] = [];
  for (const batch of chunk(ids, 100)) {
    const snaps = await db.getAll(...batch.map((id) => c.doc(id)));
    for (const s of snaps) if (s.exists) out.push(s);
  }
  return out;
}
