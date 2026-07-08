import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreStore } from '../../core/src/adapters/store/firestore.js';
import { watchCancel } from '../src/cancel.js';

// watchCancel polls message_queue/{turnId} every 250 ms and fires onCancel the
// moment cancelRequested flips to true. These tests drive that poll loop against
// the Firestore emulator. A unique projectId isolates this suite from other concurrent runs.
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = HOST;
const raw = new Firestore({ projectId: `test-engine-cancel-${process.pid}` });
// watchCancel now polls over the DocStore port; seed/signal/wipe below use the raw handle
// for the ops (listDocuments) that are not part of the port.
const db = new FirestoreStore(raw);

// Track every watcher so afterEach can detach them even if a test throws mid-way — stopping
// the poll loops before terminate() avoids leaving dangling async work.
const openWatchers: Array<() => Promise<void>> = [];
async function watch(turnId: string, onCancel: () => void): Promise<() => Promise<void>> {
  const stop = await watchCancel(db, turnId, onCancel);
  openWatchers.push(stop);
  return stop;
}

/** Write cancelRequested:true to the turn's message_queue doc — the production cancel signal
 *  (what core's requestCancel sets). watchCancel's poll loop picks this up within 250 ms. */
async function signalCancel(turnId: string): Promise<void> {
  await db.collection('message_queue').doc(turnId).set({ cancelRequested: true }, { merge: true });
}

/** Seed a non-cancelled turn doc so the listener has an existing doc to watch. */
async function seedTurn(turnId: string): Promise<void> {
  await db.collection('message_queue').doc(turnId).set({ cancelRequested: false });
}

async function wipe(): Promise<void> {
  const docs = await raw.collection('message_queue').listDocuments();
  await Promise.all(docs.map((d) => d.delete()));
}

/** Wait until `predicate` is true or the bounded timeout elapses. Polls so we don't depend
 *  on a single fixed sleep racing the async onSnapshot round-trip. */
async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Sleep a bounded grace period to give a signal that should NOT match a chance to
 *  (incorrectly) arrive before we assert it did not. */
function grace(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => wipe());
afterEach(async () => {
  // Detach every watcher opened during the test (even if it failed before its own stop()).
  await Promise.all(openWatchers.splice(0).map((stop) => stop()));
});
afterAll(() => raw.terminate());

describe('watchCancel (Firestore)', () => {
  it('fires onCancel only for the matching turn id', async () => {
    let aFired = false;
    let bFired = false;
    await seedTurn('turn-A');
    await seedTurn('turn-B');
    const stopA = await watch('turn-A', () => { aFired = true; });
    const stopB = await watch('turn-B', () => { bFired = true; });

    await signalCancel('turn-A');
    await waitFor(() => aFired);

    expect(aFired).toBe(true);
    expect(bFired).toBe(false);

    await stopA();
    await stopB();
  });

  it('does not fire onCancel after cleanup (unsubscribe)', async () => {
    let fired = false;
    await seedTurn('turn-cleanup');
    const stop = await watch('turn-cleanup', () => { fired = true; });
    await stop();

    await signalCancel('turn-cleanup');
    await grace();

    expect(fired).toBe(false);
  });

  it('fires selectively across multiple concurrent watchers', async () => {
    let aFired = false;
    let bFired = false;
    let cFired = false;
    await seedTurn('multi-A');
    await seedTurn('multi-B');
    await seedTurn('multi-C');
    const stopA = await watch('multi-A', () => { aFired = true; });
    const stopB = await watch('multi-B', () => { bFired = true; });
    const stopC = await watch('multi-C', () => { cFired = true; });

    await signalCancel('multi-B');
    await waitFor(() => bFired);

    expect(bFired).toBe(true);
    expect(aFired).toBe(false);
    expect(cFired).toBe(false);

    await stopA();
    await stopB();
    await stopC();
  });

  it('cleanup is idempotent-safe and a signal after cleanup is a no-op', async () => {
    let fired = false;
    await seedTurn('idem');
    const stop = await watch('idem', () => { fired = true; });

    await expect(stop()).resolves.toBeUndefined();

    await signalCancel('idem');
    await grace();

    expect(fired).toBe(false);
  });

  it('fires the targeted watcher at least once, untargeted stays at zero', async () => {
    let aCount = 0;
    let bCount = 0;
    await seedTurn('count-A');
    await seedTurn('count-B');
    const stopA = await watch('count-A', () => { aCount += 1; });
    const stopB = await watch('count-B', () => { bCount += 1; });

    await signalCancel('count-A');
    await waitFor(() => aCount >= 1);

    // watchCancel fires at most once (it latches `fired`), and never for the untargeted turn.
    expect(aCount).toBe(1);
    expect(bCount).toBe(0);

    await stopA();
    await stopB();
  });

  it('only fires once even if the doc is updated again after the first cancel', async () => {
    let count = 0;
    await seedTurn('once');
    const stop = await watch('once', () => { count += 1; });

    await signalCancel('once');
    await waitFor(() => count >= 1);
    // A subsequent unrelated write must not re-fire (the watcher latches after first fire).
    await db.collection('message_queue').doc('once').set({ cancelRequested: true, touched: 1 }, { merge: true });
    await grace();

    expect(count).toBe(1);
    await stop();
  });

  it('a signal for a turn nobody watches does not throw', async () => {
    await seedTurn('nobody');
    await expect(signalCancel('nobody')).resolves.toBeUndefined();
    await grace();
  });

  it('contains a throwing onCancel without poisoning other watchers', async () => {
    let goodFired = false;
    await seedTurn('throw-turn');
    await seedTurn('good-turn');
    // This watcher's handler throws; watchCancel must swallow it so there is no unhandled
    // rejection and a SEPARATE watcher still works afterwards.
    const stopBad = await watch('throw-turn', () => { throw new Error('handler boom'); });
    const stopGood = await watch('good-turn', () => { goodFired = true; });

    await signalCancel('throw-turn');
    await grace();

    await signalCancel('good-turn');
    await waitFor(() => goodFired);
    expect(goodFired).toBe(true);

    await stopBad();
    await stopGood();
  });
});
