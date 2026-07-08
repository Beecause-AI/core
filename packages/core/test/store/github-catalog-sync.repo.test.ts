import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { getSyncState, startSync, recordPage, markDone, markError, isCatalogStale } from '../../src/repos/github-catalog-sync.js';

const store = testStore('github-catalog-sync');
const db = store.db;

let intgSeq = 0;
function newIntg(): string { return `intg-${intgSeq++}`; }

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('catalog sync state', () => {
  it('getSyncState creates a default idle row', async () => {
    const intg = newIntg();
    const s = await getSyncState(db, intg);
    expect(s.status).toBe('idle');
    expect(s.repoCount).toBe(0);
    expect(s.finishedAt).toBeNull();
    expect((s as unknown as Record<string, unknown>).id).toBeUndefined();
  });

  it('getSyncState is idempotent (does not reset an existing row)', async () => {
    const intg = newIntg();
    await startSync(db, intg);
    const s = await getSyncState(db, intg);
    expect(s.status).toBe('syncing');
  });

  it('startSync → recordPage → markDone transitions', async () => {
    const intg = newIntg();
    await startSync(db, intg);
    let s = await getSyncState(db, intg);
    expect(s.status).toBe('syncing');
    await recordPage(db, intg, 100, '2');
    s = await getSyncState(db, intg);
    expect(s.repoCount).toBe(100);
    expect(s.nextCursor).toBe('2');
    await markDone(db, intg, 150);
    s = await getSyncState(db, intg);
    expect(s.status).toBe('idle');
    expect(s.repoCount).toBe(150);
    expect(s.nextCursor).toBeNull();
    expect(s.finishedAt).not.toBeNull();
  });

  it('markError records the message', async () => {
    const intg = newIntg();
    await startSync(db, intg);
    await markError(db, intg, 'boom');
    const s = await getSyncState(db, intg);
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('isCatalogStale reads finishedAt against a 1h TTL', () => {
    const base = new Date('2026-06-10T12:00:00Z');
    expect(isCatalogStale(null, base.getTime())).toBe(true);
    expect(isCatalogStale({ finishedAt: null }, base.getTime())).toBe(true);
    expect(isCatalogStale({ finishedAt: base }, base.getTime() + 30 * 60_000)).toBe(false);
    expect(isCatalogStale({ finishedAt: base }, base.getTime() + 61 * 60_000)).toBe(true);
  });
});
