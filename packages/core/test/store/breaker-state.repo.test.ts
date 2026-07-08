import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import {
  getBreaker, recordBreakerFailure, saveBreaker,
  type BreakerStateKind, type SaveBreakerInput,
} from '../../src/repos/breaker-state.js';

const store = testStore('breaker-state');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

async function countRows(key: string): Promise<number> {
  const snap = await col(db, 'breaker_state').doc(key).get();
  return snap.exists ? 1 : 0;
}

describe('getBreaker', () => {
  it('returns null for an unknown key', async () => {
    expect(await getBreaker(db, 'does-not-exist')).toBeNull();
  });
});

describe('saveBreaker (insert)', () => {
  it('inserts a new row and reads back all fields correctly', async () => {
    const key = 'openai:gpt-4o:scope-insert';
    const openedAt = new Date('2026-06-08T10:00:00.000Z');
    const nextProbeAt = new Date('2026-06-08T10:00:30.000Z');
    const input: SaveBreakerInput = { key, state: 'open', failures: 5, openedAt, nextProbeAt };
    await saveBreaker(db, input);

    const row = await getBreaker(db, key);
    expect(row).not.toBeNull();
    expect(row!.key).toBe(key);
    expect(row!.state).toBe('open');
    expect(row!.failures).toBe(5);
    expect(row!.openedAt!.getTime()).toBe(openedAt.getTime());
    expect(row!.nextProbeAt!.getTime()).toBe(nextProbeAt.getTime());
    expect(await countRows(key)).toBe(1);
  });
});

describe('saveBreaker (upsert / update)', () => {
  it('updates an existing key instead of inserting a duplicate', async () => {
    const key = 'openai:gpt-4o:scope-upsert';
    await saveBreaker(db, { key, state: 'open', failures: 5, openedAt: new Date('2026-06-08T10:00:00.000Z'), nextProbeAt: new Date('2026-06-08T10:00:30.000Z') });
    expect(await countRows(key)).toBe(1);
    await saveBreaker(db, { key, state: 'closed', failures: 0, openedAt: null, nextProbeAt: null });

    const row = await getBreaker(db, key);
    expect(row!.state).toBe('closed');
    expect(row!.failures).toBe(0);
    expect(row!.openedAt).toBeNull();
    expect(row!.nextProbeAt).toBeNull();
    expect(await countRows(key)).toBe(1);
  });
});

describe('enum states', () => {
  const states: BreakerStateKind[] = ['closed', 'open', 'half_open'];
  for (const state of states) {
    it(`can save and read back state '${state}'`, async () => {
      const key = `enum:${state}`;
      await saveBreaker(db, { key, state, failures: 0, openedAt: null, nextProbeAt: null });
      expect((await getBreaker(db, key))!.state).toBe(state);
    });
  }
});

describe('key independence', () => {
  it('saving key B does not affect key A', async () => {
    await saveBreaker(db, { key: 'indep:A', state: 'open', failures: 3, openedAt: new Date('2026-06-08T09:00:00.000Z'), nextProbeAt: null });
    await saveBreaker(db, { key: 'indep:B', state: 'closed', failures: 0, openedAt: null, nextProbeAt: null });
    const a = await getBreaker(db, 'indep:A');
    expect(a!.state).toBe('open');
    expect(a!.failures).toBe(3);
    expect(await countRows('indep:A')).toBe(1);
    expect(await countRows('indep:B')).toBe(1);
  });
});

describe('date / null round-trip', () => {
  it('round-trips real Dates and nulls', async () => {
    const openedAt = new Date('2026-01-02T03:04:05.678Z');
    const nextProbeAt = new Date('2026-01-02T03:04:35.678Z');
    await saveBreaker(db, { key: 'roundtrip:dates', state: 'open', failures: 2, openedAt, nextProbeAt });
    const dated = await getBreaker(db, 'roundtrip:dates');
    expect(dated!.openedAt!.getTime()).toBe(openedAt.getTime());
    expect(dated!.nextProbeAt!.getTime()).toBe(nextProbeAt.getTime());

    await saveBreaker(db, { key: 'roundtrip:nulls', state: 'closed', failures: 0, openedAt: null, nextProbeAt: null });
    const nulled = await getBreaker(db, 'roundtrip:nulls');
    expect(nulled!.openedAt).toBeNull();
    expect(nulled!.nextProbeAt).toBeNull();
  });
});

describe('recordBreakerFailure', () => {
  it('applies concurrent increments atomically with no lost updates', async () => {
    const key = 'google:gemini:platform';
    const bump = (cur: { failures: number } | null) => ({
      state: 'closed' as const, failures: (cur?.failures ?? 0) + 1, openedAt: null, nextProbeAt: null,
    });
    await Promise.all(Array.from({ length: 10 }, () => recordBreakerFailure(db, key, bump)));
    expect((await getBreaker(db, key))?.failures).toBe(10);
  });

  it('passes the current row to the transition (null when absent)', async () => {
    const key = 'k:miss';
    let seen: unknown = 'unset';
    await recordBreakerFailure(db, key, (cur) => { seen = cur; return { state: 'open', failures: 5, openedAt: new Date('2026-06-08T00:00:00Z'), nextProbeAt: new Date('2026-06-08T00:00:30Z') }; });
    expect(seen).toBeNull();
    const row = await getBreaker(db, key);
    expect(row?.state).toBe('open');
    expect(row?.failures).toBe(5);
  });

  it('drives exactly to the threshold (opens on the Nth, not before)', async () => {
    const key2 = 'threshold:open-at-5:exact';
    const THRESHOLD = 5;
    const trip = (cur: { failures: number } | null) => {
      const failures = (cur?.failures ?? 0) + 1;
      const open = failures >= THRESHOLD;
      return {
        state: (open ? 'open' : 'closed') as BreakerStateKind,
        failures,
        openedAt: open ? new Date('2026-06-08T12:00:00Z') : null,
        nextProbeAt: open ? new Date('2026-06-08T12:00:30Z') : null,
      };
    };
    for (let i = 1; i <= THRESHOLD; i++) {
      await recordBreakerFailure(db, key2, trip);
      const r = await getBreaker(db, key2);
      expect(r?.failures).toBe(i);
      expect(r?.state).toBe(i >= THRESHOLD ? 'open' : 'closed');
    }
  });
});
