import type { Db } from '@intellilabs/core';

/** How often to poll the turn's message_queue doc for a cancel signal. */
const POLL_MS = 250;

/** Watch for a cancel signal for one turn by polling over the DocStore port.
 *
 *  The cancel signal is `cancelRequested === true` on the `message_queue/{turnId}`
 *  doc, written transactionally by core's `requestCancel`. We poll that doc and fire
 *  `onCancel` the moment the flag flips. Returns a cleanup function that stops the
 *  poll loop; it must be called when the turn ends.
 *
 *  Realtime `onSnapshot` is a Firestore-specific capability outside the DocStore port
 *  (the OSS Postgres adapter can't provide it), so cancellation rides on a bounded poll
 *  instead. The engine's post-loop `isCancelRequested` re-check remains the backstop. */
export async function watchCancel(
  db: Db,
  turnId: string,
  onCancel: () => void,
): Promise<() => Promise<void>> {
  let fired = false;
  let stopped = false;
  const ref = db.collection('message_queue').doc(turnId);

  async function poll(): Promise<void> {
    while (!stopped && !fired) {
      try {
        const snap = await ref.get();
        if (snap.exists && snap.data()?.['cancelRequested'] === true) {
          fired = true;
          try {
            onCancel();
          } catch {
            /* swallow — caller owns turn abort semantics */
          }
          return;
        }
      } catch {
        // Read errored mid-turn; cancellation for this turn is lost here —
        // the engine's post-loop isCancelRequested re-check is the fallback.
      }
      if (stopped || fired) return;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  // Fire-and-forget the loop; the returned stop() ends it.
  const loop = poll();

  return async () => {
    stopped = true;
    await loop;
  };
}
