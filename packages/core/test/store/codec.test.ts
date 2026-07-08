import { afterAll, describe, it, expect } from 'vitest';
import { toDoc, fromDoc, applyDefaults } from '../../src/store/codec.js';
import { col } from '../../src/store/collections.js';
import { testStore, wipe } from './emulator.js';

describe('codec', () => {
  it('applyDefaults fills id and createdAt when missing', () => {
    const row = applyDefaults({ name: 'Acme' }, 'gen-id');
    expect(row.id).toBe('gen-id');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('applyDefaults keeps an explicit id and createdAt', () => {
    const created = new Date(1000);
    const row = applyDefaults({ id: 'mine', createdAt: created }, 'gen-id');
    expect(row.id).toBe('mine');
    expect(row.createdAt).toBe(created);
  });

  it('toDoc strips undefined but preserves null', () => {
    const doc = toDoc({ id: 'x', name: 'Acme', note: undefined, parentId: null });
    expect('note' in doc).toBe(false);
    expect(doc.parentId).toBeNull();
  });

  it('fromDoc injects the doc id and passes data() through verbatim', () => {
    // Date normalization is now the adapter Snapshot.data()'s job (see the round-trip test
    // below); fromDoc is pure id-injection over whatever the port hands it.
    const snap = {
      id: 'x',
      exists: true,
      data: () => ({ name: 'Acme', createdAt: new Date(0), meta: { at: new Date(5000) } }),
    };
    expect(fromDoc(snap as any)).toEqual({
      id: 'x',
      name: 'Acme',
      createdAt: new Date(0),
      meta: { at: new Date(5000) },
    });
  });
});

// The Timestamp→Date normalization that used to live in fromDoc now lives in the
// FirestoreStore adapter's Snapshot.data(). Exercise it through a real emulator round-trip,
// including a NESTED date, so the deepDates conversion stays covered.
describe('FirestoreStore Snapshot.data() date normalization (emulator)', () => {
  const store = testStore('codec-dates');
  afterAll(async () => {
    await wipe(store.db);
    await store.close();
  });

  it('converts top-level and nested Firestore Timestamps back to Date', async () => {
    const ref = col(store.db, 'organizations').doc();
    await ref.set(toDoc({ createdAt: new Date(0), meta: { at: new Date(5000) } }));
    const data = (await ref.get()).data()!;
    expect(data.createdAt).toBeInstanceOf(Date);
    expect((data.createdAt as Date).getTime()).toBe(0);
    expect((data.meta as { at: Date }).at).toBeInstanceOf(Date);
    expect((data.meta as { at: Date }).at.getTime()).toBe(5000);
  });
});
