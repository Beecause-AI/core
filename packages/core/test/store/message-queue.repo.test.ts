import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  enqueueTurn,
  claimNextTurn,
  markTurnDone,
  requestCancel,
  requeueTurn,
  getTurn,
  listLaneQueue,
  listActiveTurns,
  peekNextQueued,
  isCancelRequested,
} from '../../src/repos/message-queue.js';

const store = testStore('message-queue');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const enq = (laneId: string, payload: unknown = {}) =>
  enqueueTurn(db, { laneId, orgId: 'o1', source: 'web', payload });

describe('message-queue repo (Firestore)', () => {
  it('assigns gap-free increasing seq per lane', async () => {
    const a = await enq('lane-1');
    const b = await enq('lane-1');
    const c = await enq('lane-2');
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(1); // independent lane
    expect(a.status).toBe('queued');
  });

  it('assigns gap-free seq under concurrent enqueue (transaction retry)', async () => {
    await Promise.all(Array.from({ length: 25 }, () => enq('hot')));
    const seqs = (await listLaneQueue(db, 'hot')).map((t) => t.seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1)); // 1..25, no gaps/dupes
  });

  it('claimNextTurn is single-flight and claims lowest seq', async () => {
    await enq('L');
    await enq('L');
    const first = await claimNextTurn(db, 'L');
    expect(first?.seq).toBe(1);
    expect(first?.status).toBe('running');
    // already running → no second claim
    expect(await claimNextTurn(db, 'L')).toBeNull();
    await markTurnDone(db, first!.id);
    const second = await claimNextTurn(db, 'L');
    expect(second?.seq).toBe(2);
  });

  it('only one of two concurrent claims wins', async () => {
    await enq('R');
    const [x, y] = await Promise.all([claimNextTurn(db, 'R'), claimNextTurn(db, 'R')]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
  });

  it('requestCancel cancels a queued turn and flags a running one', async () => {
    const q = await enq('C');
    const r = await requestCancel(db, q.id);
    expect(r).toEqual({ cancelled: true, wasRunning: false });
    expect((await getTurn(db, q.id))?.status).toBe('cancelled');

    const q2 = await enq('C2');
    const claimed = await claimNextTurn(db, 'C2');
    const r2 = await requestCancel(db, claimed!.id);
    expect(r2).toEqual({ cancelled: true, wasRunning: true });
    expect(await isCancelRequested(db, claimed!.id)).toBe(true);
    expect((await getTurn(db, q2.id))?.status).toBe('running'); // still running, just flagged
  });

  it('requeueTurn returns a turn to queued and peekNextQueued sees it', async () => {
    const q = await enq('Q');
    const claimed = await claimNextTurn(db, 'Q');
    await requeueTurn(db, claimed!.id, { reason: 'temp' });
    const next = await peekNextQueued(db, 'Q');
    expect(next?.id).toBe(q.id);
    const after = await getTurn(db, q.id);
    expect(after?.status).toBe('queued');
    expect(after?.attempts).toBe(1);
  });

  it('listActiveTurns spans lanes, excludes done', async () => {
    const a = await enq('m1');
    await enq('m2');
    await markTurnDone(db, a.id);
    const active = await listActiveTurns(db, ['m1', 'm2']);
    expect(active.map((t) => t.laneId).sort()).toEqual(['m2']);
    expect(await listActiveTurns(db, [])).toEqual([]);
  });
});
