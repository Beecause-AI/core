import { describe, it, expect, afterAll } from 'vitest';
import { col } from '../../src/store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../../src/store/codec.js';
import { testStore, wipe } from './emulator.js';
import type { Organization } from '../../src/store/types.js';

const store = testStore('smoke');

afterAll(async () => {
  await wipe(store.db);
  await store.close();
});

describe('Firestore emulator round-trip', () => {
  it('writes and reads back a document with Timestamp→Date conversion', async () => {
    const ref = col(store.db, 'organizations').doc();
    const row = applyDefaults<Partial<Organization>>(
      { name: 'Acme', slug: 'acme' },
      ref.id,
    );
    await ref.set(toDoc(row));

    const snap = await ref.get();
    const read = fromDoc<Organization>(snap);
    expect(read.id).toBe(ref.id);
    expect(read.name).toBe('Acme');
    expect(read.slug).toBe('acme');
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it('queries by an equality filter', async () => {
    const ref = col(store.db, 'organizations').doc();
    await ref.set(toDoc(applyDefaults<Partial<Organization>>({ name: 'Beta', slug: 'beta-co' }, ref.id)));
    const rows = (await col(store.db, 'organizations').where('slug', '==', 'beta-co').get()).map(
      (d) => fromDoc<Organization>(d),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Beta');
  });
});
