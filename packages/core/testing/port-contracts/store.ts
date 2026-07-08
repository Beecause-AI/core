import { beforeEach, describe, expect, it } from 'vitest';
import { AlreadyExistsError, FieldValue, type DocData, type DocRef, type DocStore } from '../../src/ports/store.js';

/** Behavioural contract every DocStore adapter must satisfy. Import and call from an
 *  adapter's test file: `docStoreContract('pg', async () => makePgStore())`.
 *  makeStore MUST return a fresh, empty store per call (each test gets its own). */
export function docStoreContract(
  name: string,
  makeStore: () => DocStore | Promise<DocStore>,
): void {
  describe(`DocStore contract: ${name}`, () => {
    let store: DocStore;
    let ref: () => DocRef;
    beforeEach(async () => {
      store = await makeStore();
      ref = () => store.collection('docs').doc('x');
    });

    it('get() on a missing doc reports !exists and undefined data', async () => {
      const snap = await ref().get();
      expect(snap.exists).toBe(false);
      expect(snap.data()).toBeUndefined();
    });

    it('set() then get() round-trips the data', async () => {
      await ref().set({ a: 1, b: 'two' });
      const snap = await ref().get();
      expect(snap.exists).toBe(true);
      expect(snap.data()).toMatchObject({ a: 1, b: 'two' });
    });

    it('set() without merge replaces the whole document', async () => {
      await ref().set({ a: 1, b: 2 });
      await ref().set({ a: 9 });
      expect((await ref().get()).data()).toEqual({ a: 9 });
    });

    it('set({merge:true}) preserves fields not in the write', async () => {
      await ref().set({ a: 1, keep: 'yes' });
      await ref().set({ a: 2 }, { merge: true });
      expect((await ref().get()).data()).toMatchObject({ a: 2, keep: 'yes' });
    });

    it('update() changes named fields and keeps the rest', async () => {
      await ref().set({ a: 1, keep: 'yes' });
      await ref().update({ a: 5 });
      expect((await ref().get()).data()).toMatchObject({ a: 5, keep: 'yes' });
    });

    it('create() writes when absent and rejects when present', async () => {
      await ref().create({ a: 1 });
      expect((await ref().get()).data()).toMatchObject({ a: 1 });
      await expect(ref().create({ a: 2 })).rejects.toBeInstanceOf(AlreadyExistsError);
    });

    it('delete() removes the document', async () => {
      await ref().set({ a: 1 });
      await ref().delete();
      expect((await ref().get()).exists).toBe(false);
    });

    it('FieldValue.serverTimestamp() writes a present value', async () => {
      await ref().set({ at: FieldValue.serverTimestamp() });
      const at = (await ref().get()).data()!.at;
      expect(at).toBeDefined();
      expect(at).not.toBeNull();
    });

    it('FieldValue.increment(n) adds atomically across writes', async () => {
      await ref().set({ count: FieldValue.increment(5) });
      expect((await ref().get()).data()!.count).toBe(5);
      await ref().update({ count: FieldValue.increment(3) });
      expect((await ref().get()).data()!.count).toBe(8);
    });

    const seed = async (rows: Array<DocData & { id: string }>) => {
      for (const r of rows) await store.collection('items').doc(r.id).set(r);
    };
    const q = () => store.collection('items');

    it('where(==) filters to matching docs', async () => {
      await seed([
        { id: 'a', k: 'x', n: 1 },
        { id: 'b', k: 'y', n: 2 },
        { id: 'c', k: 'x', n: 3 },
      ]);
      const got = await q().where('k', '==', 'x').get();
      expect(new Set(got.map((s) => s.id))).toEqual(new Set(['a', 'c']));
    });

    it('where(in) matches any listed value', async () => {
      await seed([{ id: 'a', k: 'x' }, { id: 'b', k: 'y' }, { id: 'c', k: 'z' }]);
      const got = await q().where('k', 'in', ['x', 'z']).get();
      expect(new Set(got.map((s) => s.id))).toEqual(new Set(['a', 'c']));
    });

    it('where(<) filters a range and orderBy+limit orders/caps', async () => {
      await seed([{ id: 'a', n: 1 }, { id: 'b', n: 5 }, { id: 'c', n: 3 }, { id: 'd', n: 9 }]);
      const under5 = await q().where('n', '<', 5).get();
      expect(new Set(under5.map((s) => s.id))).toEqual(new Set(['a', 'c']));
      const top2 = await q().orderBy('n', 'desc').limit(2).get();
      expect(top2.map((s) => s.id)).toEqual(['d', 'b']);
    });

    it('where(<) on Date fields compares chronologically with orderBy', async () => {
      await seed([
        { id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') },
        { id: 'mid', createdAt: new Date('2026-06-01T00:00:00Z') },
        { id: 'new', createdAt: new Date('2026-12-01T00:00:00Z') },
      ]);
      const before = await q()
        .where('createdAt', '<', new Date('2026-07-01T00:00:00Z'))
        .orderBy('createdAt', 'desc')
        .get();
      expect(before.map((s) => s.id)).toEqual(['mid', 'old']);
    });

    it('orderBy chains for tie-breaking', async () => {
      await seed([
        { id: 'a', p: 1, s: 2 },
        { id: 'b', p: 1, s: 1 },
        { id: 'c', p: 0, s: 9 },
      ]);
      const got = await q().orderBy('p', 'asc').orderBy('s', 'asc').get();
      expect(got.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    });

    it('count() returns the number of matching docs', async () => {
      await seed([{ id: 'a', k: 'x' }, { id: 'b', k: 'x' }, { id: 'c', k: 'y' }]);
      expect(await q().where('k', '==', 'x').count()).toBe(2);
    });

    it('aggregate() sums and counts a filtered set', async () => {
      await seed([
        { id: 'a', k: 'x', cost: 2 },
        { id: 'b', k: 'x', cost: 3 },
        { id: 'c', k: 'y', cost: 9 },
      ]);
      const agg = await q().where('k', '==', 'x').aggregate({ sum: 'cost', count: true });
      expect(agg).toEqual({ sum: 5, count: 2 });
    });

    it('aggregate() over an empty result set returns zero', async () => {
      await seed([{ id: 'a', k: 'x', cost: 5 }]);
      const agg = await q().where('k', '==', 'nomatch').aggregate({ sum: 'cost', count: true });
      expect(agg).toEqual({ sum: 0, count: 0 });
    });

    it('getAll batches by ref and returns existing docs', async () => {
      await seed([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
      const snaps = await store.getAll(
        store.collection('items').doc('a'),
        store.collection('items').doc('missing'),
        store.collection('items').doc('b'),
      );
      const present = snaps.filter((s) => s.exists).map((s) => s.id);
      expect(new Set(present)).toEqual(new Set(['a', 'b']));
    });

    // --- pinned CRUD semantics (from the Plan 2 whole-branch review) ---
    // NOTE: set(merge) is TOP-LEVEL field merge only; nested-map merge semantics are
    // adapter-defined and MUST NOT be relied on (see the persistence-port design doc).

    it('update() on a missing document rejects (must-exist)', async () => {
      await expect(ref().update({ a: 1 })).rejects.toThrow();
    });

    it('update() with a dotted key writes a nested path, not a literal key', async () => {
      await ref().set({ a: { c: 2 } });
      await ref().update({ 'a.b': 1 });
      expect((await ref().get()).data()).toEqual({ a: { b: 1, c: 2 } });
    });

    // --- transactions ---
    it('runTransaction commits multiple writes atomically and returns the fn value', async () => {
      const out = await store.runTransaction(async (tx) => {
        tx.set(store.collection('t').doc('a'), { v: 1 });
        tx.set(store.collection('t').doc('b'), { v: 2 });
        return 'ok';
      });
      expect(out).toBe('ok');
      expect((await store.collection('t').doc('a').get()).data()).toMatchObject({ v: 1 });
      expect((await store.collection('t').doc('b').get()).data()).toMatchObject({ v: 2 });
    });

    it('runTransaction reads a doc then conditionally writes (read-modify-write)', async () => {
      await store.collection('t').doc('c').set({ n: 1 });
      await store.runTransaction(async (tx) => {
        const snap = await tx.get(store.collection('t').doc('c'));
        tx.update(store.collection('t').doc('c'), { n: (snap.data()!.n as number) + 10 });
      });
      expect((await store.collection('t').doc('c').get()).data()!.n).toBe(11);
    });

    it('runTransaction can read a query', async () => {
      await seed([
        { id: 'a', k: 'x' },
        { id: 'b', k: 'x' },
        { id: 'c', k: 'y' },
      ]);
      const ids = await store.runTransaction(async (tx) => {
        const snaps = await tx.get(store.collection('items').where('k', '==', 'x'));
        return snaps.map((s) => s.id);
      });
      expect(new Set(ids)).toEqual(new Set(['a', 'b']));
    });

    it('runTransaction serializes concurrent read-modify-write (no lost updates)', async () => {
      await store.collection('ctr').doc('c').set({ n: 0 });
      const inc = () =>
        store.runTransaction(async (tx) => {
          const snap = await tx.get(store.collection('ctr').doc('c'));
          tx.set(store.collection('ctr').doc('c'), { n: (snap.data()!.n as number) + 1 });
        });
      await Promise.all([inc(), inc(), inc(), inc(), inc()]);
      expect((await store.collection('ctr').doc('c').get()).data()!.n).toBe(5);
    });

    // --- batch ---
    it('batch applies multiple writes on commit', async () => {
      const b = store.batch();
      b.set(store.collection('bat').doc('a'), { v: 1 });
      b.set(store.collection('bat').doc('b'), { v: 2 });
      await b.commit();
      expect((await store.collection('bat').doc('a').get()).data()).toMatchObject({ v: 1 });
      expect((await store.collection('bat').doc('b').get()).data()).toMatchObject({ v: 2 });
    });

    it('batch deletes', async () => {
      await store.collection('bat').doc('del').set({ v: 1 });
      const b = store.batch();
      b.delete(store.collection('bat').doc('del'));
      await b.commit();
      expect((await store.collection('bat').doc('del').get()).exists).toBe(false);
    });

    it('batch honors FieldValue sentinels', async () => {
      const b = store.batch();
      b.set(store.collection('bat').doc('x'), { count: FieldValue.increment(5) });
      await b.commit();
      expect((await store.collection('bat').doc('x').get()).data()!.count).toBe(5);
    });

    it('doc() with no id generates distinct auto-ids that round-trip', async () => {
      const c = store.collection('auto');
      const r1 = c.doc();
      const r2 = c.doc();
      expect(r1.id).toBeTruthy();
      expect(r2.id).toBeTruthy();
      expect(r1.id).not.toBe(r2.id);
      await r1.set({ v: 7 });
      expect((await store.collection('auto').doc(r1.id).get()).data()).toMatchObject({ v: 7 });
    });

    it('batch commit is all-or-nothing (a failing op rolls back the whole batch)', async () => {
      await store.collection('bat').doc('keep').set({ v: 1 });
      const b = store.batch();
      b.set(store.collection('bat').doc('new'), { v: 2 });
      b.update(store.collection('bat').doc('missing'), { v: 3 }); // update-on-missing fails the commit
      await expect(b.commit()).rejects.toThrow();
      expect((await store.collection('bat').doc('new').get()).exists).toBe(false); // rolled back
      expect((await store.collection('bat').doc('keep').get()).data()).toMatchObject({ v: 1 });
    });

    it('create inside a transaction rejects the whole txn on conflict', async () => {
      await store.collection('t').doc('x').set({ v: 1 });
      await expect(
        store.runTransaction(async (tx) => {
          tx.create(store.collection('t').doc('x'), { v: 2 });
        }),
      ).rejects.toThrow();
      expect((await store.collection('t').doc('x').get()).data()).toMatchObject({ v: 1 });
    });

    it('delete of a missing doc is a no-op success (DocRef and batch)', async () => {
      await expect(store.collection('d').doc('nope').delete()).resolves.toBeUndefined();
      const b = store.batch();
      b.delete(store.collection('d').doc('nope2'));
      await expect(b.commit()).resolves.toBeUndefined();
    });

    it('tx.update with FieldValue.increment is atomic under concurrency', async () => {
      await store.collection('ctr').doc('i').set({ n: 0 });
      const bump = () =>
        store.runTransaction(async (tx) => {
          await tx.get(store.collection('ctr').doc('i'));
          tx.update(store.collection('ctr').doc('i'), { n: FieldValue.increment(1) });
        });
      await Promise.all([bump(), bump(), bump(), bump(), bump()]);
      expect((await store.collection('ctr').doc('i').get()).data()!.n).toBe(5);
    });

    it('Date values round-trip (top-level and nested) as Date', async () => {
      const d = new Date('2026-03-04T05:06:07.000Z');
      await store.collection('dt').doc('a').set({ at: d, meta: { seen: d }, tags: [d] });
      const got = (await store.collection('dt').doc('a').get()).data()!;
      expect(got.at).toBeInstanceOf(Date);
      expect((got.at as Date).toISOString()).toBe(d.toISOString());
      expect((got.meta as any).seen).toBeInstanceOf(Date);
      expect((got.tags as any[])[0]).toBeInstanceOf(Date);
    });

    it('orderBy sorts numeric fields numerically (not lexically) across digit widths', async () => {
      await seed([{ id: 'a', n: 2 }, { id: 'b', n: 10 }, { id: 'c', n: 3 }, { id: 'd', n: 20 }]);
      const asc = await q().orderBy('n', 'asc').get();
      expect(asc.map((s) => s.data()!.n)).toEqual([2, 3, 10, 20]);
      const desc = await q().orderBy('n', 'desc').limit(1).get();
      expect(desc[0]!.data()!.n).toBe(20);
    });

    it('where(<) on numeric fields compares numerically across digit widths', async () => {
      await seed([{ id: 'a', n: 2 }, { id: 'b', n: 10 }, { id: 'c', n: 3 }, { id: 'd', n: 20 }]);
      const under10 = await q().where('n', '<', 10).get();
      expect(new Set(under10.map((s) => s.data()!.n))).toEqual(new Set([2, 3]));
    });
  });
}
