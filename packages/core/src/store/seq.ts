import type { DocStore, Txn } from '../ports/store.js';
import { col } from './collections.js';

/** Monotonic per-lane counter, allocated INSIDE a transaction. Replaces
 *  `pg_advisory_xact_lock(...) + select max(seq)+1`: the store retries the transaction on
 *  contention, so seq stays gap-free and strictly increasing per lane (optimistic, not blocking).
 *
 *  MUST be called before any writes in the transaction (Firestore requires all reads first). */
export async function nextSeq(tx: Txn, db: DocStore, laneId: string): Promise<number> {
  const ref = col(db, 'lanes').doc(laneId);
  const snap = await tx.get(ref);
  const next = ((snap.exists ? (snap.data()?.['seq'] as number | undefined) : 0) ?? 0) + 1;
  tx.set(ref, { seq: next }, { merge: true });
  return next;
}
