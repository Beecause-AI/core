import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, FieldValue } from '../store/codec.js';
import { chunk } from '../store/query.js';
import { nextSeq } from '../store/seq.js';
import type { QueuedTurn } from '../store/types.js';

export type TurnSource = 'slack' | 'teams' | 'web' | 'api' | 'internal';

export type EnqueueInput = {
  laneId: string;
  orgId: string;
  source: TurnSource;
  payload: unknown;
};

export async function enqueueTurn(db: Db, input: EnqueueInput): Promise<QueuedTurn> {
  // Replaces pg_advisory_xact_lock + max(seq)+1: a transaction over the per-lane
  // counter doc gives gap-free, strictly-increasing seq with optimistic retry on contention.
  const ref = col(db, 'message_queue').doc();
  await db.runTransaction(async (tx) => {
    const seq = await nextSeq(tx, db, input.laneId); // read+write the lane counter (read happens first)
    tx.set(
      ref,
      toDoc({
        id: ref.id,
        laneId: input.laneId,
        orgId: input.orgId,
        source: input.source,
        payload: input.payload,
        seq,
        status: 'queued',
        attempts: 0,
        deferrals: 0,
        cancelRequested: false,
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }),
    );
  });
  return fromDoc<QueuedTurn>(await ref.get());
}

/** Claim the lowest-seq queued turn for a lane, IFF nothing is running there.
 *  Marks it `running`. Returns null if a turn is already running or none is queued. */
export async function claimNextTurn(db: Db, laneId: string): Promise<QueuedTurn | null> {
  const c = col(db, 'message_queue');
  return db.runTransaction(async (tx) => {
    const running = await tx.get(
      c.where('laneId', '==', laneId).where('status', '==', 'running').limit(1),
    );
    if (running.length > 0) return null;
    const nextSnaps = await tx.get(
      c.where('laneId', '==', laneId).where('status', '==', 'queued').orderBy('seq', 'asc').limit(1),
    );
    if (nextSnaps.length === 0) return null;
    const snap = nextSnaps[0]!;
    // doc.ref has no equivalent on port Snapshot — reconstruct via collection.doc(snap.id)
    tx.update(col(db, 'message_queue').doc(snap.id), { status: 'running', startedAt: FieldValue.serverTimestamp() });
    return { ...fromDoc<QueuedTurn>(snap), status: 'running' } as QueuedTurn;
  });
}

export async function markTurnDone(db: Db, id: string): Promise<void> {
  await col(db, 'message_queue').doc(id).update({ status: 'done', finishedAt: FieldValue.serverTimestamp() });
}

export async function markTurnFailed(db: Db, id: string, error: unknown): Promise<void> {
  await col(db, 'message_queue').doc(id).update(
    toDoc({ status: 'failed', error, finishedAt: FieldValue.serverTimestamp(), attempts: FieldValue.increment(1) }),
  );
}

export async function markTurnCancelled(db: Db, id: string): Promise<void> {
  await col(db, 'message_queue').doc(id).update({ status: 'cancelled', finishedAt: FieldValue.serverTimestamp() });
}

/** Return a running turn to the queue (temporary failure / breaker deferral). bumpAttempt=true
 *  counts a real provider attempt; bumpAttempt=false counts a breaker-open deferral instead —
 *  the two are bounded separately (MAX_ATTEMPTS vs the DLQ-safe deferral budget). */
export async function requeueTurn(db: Db, id: string, error: unknown, bumpAttempt = true): Promise<void> {
  await col(db, 'message_queue').doc(id).update(
    toDoc({
      status: 'queued',
      startedAt: null,
      error,
      ...(bumpAttempt ? { attempts: FieldValue.increment(1) } : { deferrals: FieldValue.increment(1) }),
    }),
  );
}

export async function requestCancel(
  db: Db,
  id: string,
): Promise<{ cancelled: boolean; wasRunning: boolean }> {
  const ref = col(db, 'message_queue').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { cancelled: false, wasRunning: false };
    const status = snap.data()?.['status'] as QueuedTurn['status'];
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      return { cancelled: false, wasRunning: false };
    }
    if (status === 'queued') {
      tx.update(ref, { status: 'cancelled', cancelRequested: true, finishedAt: FieldValue.serverTimestamp() });
      return { cancelled: true, wasRunning: false };
    }
    // running — flag it; the engine's boundary check finishes it.
    tx.update(ref, { cancelRequested: true });
    return { cancelled: true, wasRunning: true };
  });
}

export async function isCancelRequested(db: Db, id: string): Promise<boolean> {
  const snap = await col(db, 'message_queue').doc(id).get();
  return snap.exists ? ((snap.data()?.['cancelRequested'] as boolean | undefined) ?? false) : false;
}

export async function getTurn(db: Db, id: string): Promise<QueuedTurn | null> {
  const snap = await col(db, 'message_queue').doc(id).get();
  return snap.exists ? fromDoc<QueuedTurn>(snap) : null;
}

export async function listLaneQueue(db: Db, laneId: string): Promise<QueuedTurn[]> {
  const snaps = await col(db, 'message_queue').where('laneId', '==', laneId).orderBy('seq', 'asc').get();
  return snaps.map((d) => fromDoc<QueuedTurn>(d));
}

/** In-flight turns (queued or running) across a set of lanes — powers the live "is anything
 *  happening?" view. Empty `laneIds` ⇒ empty result (no query). */
export async function listActiveTurns(db: Db, laneIds: string[]): Promise<QueuedTurn[]> {
  if (laneIds.length === 0) return [];
  // Firestore forbids two `in`/disjunction filters in one query, so filter status in JS.
  const rows: QueuedTurn[] = [];
  for (const batch of chunk(laneIds, 30)) {
    const snaps = await col(db, 'message_queue').where('laneId', 'in', batch).get();
    for (const d of snaps) {
      const t = fromDoc<QueuedTurn>(d);
      if (t.status === 'queued' || t.status === 'running') rows.push(t);
    }
  }
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The lowest-seq still-queued turn for a lane, or null. Cheap single-row lookup
 *  used to publish the next doorbell after a turn finishes. */
export async function peekNextQueued(db: Db, laneId: string): Promise<QueuedTurn | null> {
  const snaps = await col(db, 'message_queue')
    .where('laneId', '==', laneId)
    .where('status', '==', 'queued')
    .orderBy('seq', 'asc')
    .limit(1)
    .get();
  return snaps.length === 0 ? null : fromDoc<QueuedTurn>(snaps[0]!);
}
