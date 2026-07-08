import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, FieldValue } from '../store/codec.js';
import type { BreakerRow } from '../store/types.js';

export type BreakerStateKind = BreakerRow['state'];

export type SaveBreakerInput = {
  key: string;
  state: BreakerStateKind;
  failures: number;
  openedAt: Date | null;
  nextProbeAt: Date | null;
};

export async function getBreaker(db: Db, key: string): Promise<BreakerRow | null> {
  const snap = await col(db, 'breaker_state').doc(key).get();
  return snap.exists ? fromDoc<BreakerRow>(snap) : null;
}

export async function saveBreaker(db: Db, input: SaveBreakerInput): Promise<void> {
  // doc id == natural key, so upsert is a merge-set (replaces onConflictDoUpdate).
  await col(db, 'breaker_state').doc(input.key).set(
    {
      key: input.key,
      state: input.state,
      failures: input.failures,
      openedAt: input.openedAt,
      nextProbeAt: input.nextProbeAt,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Atomically read-modify-write a breaker row inside a Firestore transaction so
 *  concurrent failures on the same breaker key (across different lanes, which the
 *  lane lock does NOT serialize) cannot lose updates. `next` receives the current
 *  row (or null) and returns the new field values. Firestore retries on contention,
 *  replacing the per-key `pg_advisory_xact_lock`. */
export async function recordBreakerFailure(
  db: Db,
  key: string,
  next: (current: BreakerRow | null) => {
    state: BreakerStateKind;
    failures: number;
    openedAt: Date | null;
    nextProbeAt: Date | null;
  },
): Promise<void> {
  const ref = col(db, 'breaker_state').doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? fromDoc<BreakerRow>(snap) : null;
    const computed = next(current);
    tx.set(
      ref,
      toDoc({ key, ...computed, updatedAt: FieldValue.serverTimestamp() }),
      { merge: true },
    );
  });
}
