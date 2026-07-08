import { beforeEach, describe, expect, it } from 'vitest';
import type { VectorIndex } from '../../src/ports/vector.js';

/** Behavioural contract every REAL VectorIndex adapter must satisfy (Disabled is exempt — it is
 *  intentionally inert). Import and call from an adapter's test file:
 *  `vectorIndexContract('pgvector', async () => makePgIndex())`. */
export function vectorIndexContract(
  name: string,
  makeIndex: () => VectorIndex | Promise<VectorIndex>,
): void {
  describe(`VectorIndex contract: ${name}`, () => {
    let index: VectorIndex;
    beforeEach(async () => {
      index = await makeIndex();
    });

    it('returns points ordered nearest-first by cosine distance', async () => {
      await index.upsert([
        { id: 'a', embedding: [1, 0, 0] },
        { id: 'b', embedding: [0, 1, 0] },
        { id: 'c', embedding: [1, 1, 0] },
      ]);
      const got = await index.findNeighbors([1, 0.1, 0], { limit: 3 });
      expect(got.map((n) => n.id)).toEqual(['a', 'c', 'b']);
      expect(got[0]!.distance).toBeLessThanOrEqual(got[1]!.distance);
      expect(got[1]!.distance).toBeLessThanOrEqual(got[2]!.distance);
    });

    it('honours the limit', async () => {
      await index.upsert([
        { id: 'a', embedding: [1, 0, 0] },
        { id: 'b', embedding: [0, 1, 0] },
      ]);
      expect(await index.findNeighbors([1, 0, 0], { limit: 1 })).toHaveLength(1);
    });

    it('filters by restrict namespace (OR within, AND across)', async () => {
      await index.upsert([
        { id: 'a', embedding: [1, 0, 0], restricts: { proj: 'p1', scope: 'team' } },
        { id: 'b', embedding: [1, 0, 0], restricts: { proj: 'p2', scope: 'team' } },
        { id: 'c', embedding: [1, 0, 0], restricts: { proj: 'p1', scope: 'private' } },
      ]);
      const p1 = await index.findNeighbors([1, 0, 0], { limit: 10, filter: { proj: ['p1'] } });
      expect(new Set(p1.map((n) => n.id))).toEqual(new Set(['a', 'c']));
      const both = await index.findNeighbors([1, 0, 0], { limit: 10, filter: { proj: ['p1', 'p2'] } });
      expect(new Set(both.map((n) => n.id))).toEqual(new Set(['a', 'b', 'c']));
      const p1team = await index.findNeighbors([1, 0, 0], {
        limit: 10,
        filter: { proj: ['p1'], scope: ['team'] },
      });
      expect(p1team.map((n) => n.id)).toEqual(['a']);
    });

    it('treats an empty value list as no constraint', async () => {
      await index.upsert([{ id: 'a', embedding: [1, 0, 0], restricts: { proj: 'p1' } }]);
      const got = await index.findNeighbors([1, 0, 0], { limit: 10, filter: { proj: [] } });
      expect(got.map((n) => n.id)).toEqual(['a']);
    });

    it('overwrites a point on re-upsert of the same id', async () => {
      await index.upsert([{ id: 'a', embedding: [1, 0, 0] }]);
      await index.upsert([{ id: 'a', embedding: [0, 1, 0] }]);
      const near = await index.findNeighbors([0, 1, 0], { limit: 1 });
      expect(near[0]!.id).toBe('a');
      expect(near[0]!.distance).toBeCloseTo(0, 5);
    });

    it('removes points', async () => {
      await index.upsert([{ id: 'a', embedding: [1, 0, 0] }]);
      await index.remove(['a']);
      expect(await index.findNeighbors([1, 0, 0], { limit: 10 })).toHaveLength(0);
    });
  });
}
