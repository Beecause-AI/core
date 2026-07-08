import { Firestore } from '@google-cloud/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { wipe } from './emulator.js';
import { FirestoreVectorIndex } from '../../src/store/vector.js';

// FirestoreVectorIndex works over the raw Firestore SDK (native KNN is not part of the
// DocStore port), so this suite builds its own emulator-backed handle.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const db = new Firestore({ projectId: `test-firestore-vector-${process.pid}`, ignoreUndefinedProperties: true });
const vector = new FirestoreVectorIndex(db);

beforeEach(() => wipe(db));
afterAll(() => db.terminate());

// 3-d embeddings keep cosine ranking deterministic and the test fast.
const E = (a: number, b: number, c: number) => [a, b, c];

describe('FirestoreVectorIndex (emulator)', () => {
  it('findNeighbors returns the topically-nearest point first', async () => {
    await vector.upsert([
      { id: 'x', embedding: E(1, 0, 0), restricts: { orgId: 'o', projectId: 'p', kind: 'summary' } },
      { id: 'y', embedding: E(0, 1, 0), restricts: { orgId: 'o', projectId: 'p', kind: 'summary' } },
    ]);
    const got = await vector.findNeighbors(E(1, 0.05, 0), {
      limit: 5,
      filter: { orgId: ['o'], projectId: ['p'], kind: ['summary'] },
    });
    expect(got.map((n) => n.id)).toEqual(['x', 'y']);
    expect(got[0]!.distance).toBeLessThan(got[1]!.distance);
  });

  it('prefilters scope the search — no cross-project / cross-kind leakage', async () => {
    await vector.upsert([
      { id: 'mine', embedding: E(1, 0, 0), restricts: { orgId: 'o', projectId: 'p', kind: 'summary' } },
      { id: 'other-project', embedding: E(1, 0, 0), restricts: { orgId: 'o', projectId: 'OTHER', kind: 'summary' } },
      { id: 'other-kind', embedding: E(1, 0, 0), restricts: { orgId: 'o', projectId: 'p', kind: 'kg' } },
    ]);
    const got = await vector.findNeighbors(E(1, 0, 0), {
      limit: 10,
      filter: { orgId: ['o'], projectId: ['p'], kind: ['summary'] },
    });
    expect(got.map((n) => n.id)).toEqual(['mine']);
  });

  it('remove deletes points so they no longer match', async () => {
    await vector.upsert([
      { id: 'gone', embedding: E(1, 0, 0), restricts: { orgId: 'o', projectId: 'p', kind: 'summary' } },
    ]);
    await vector.remove(['gone']);
    const got = await vector.findNeighbors(E(1, 0, 0), {
      limit: 5,
      filter: { orgId: ['o'], projectId: ['p'], kind: ['summary'] },
    });
    expect(got).toEqual([]);
  });

  it('an empty filter value list is skipped (matches InMemory semantics)', async () => {
    await vector.upsert([
      { id: 'k', embedding: E(1, 0, 0), restricts: { orgId: 'o', projectId: 'p', kind: 'summary' } },
    ]);
    const got = await vector.findNeighbors(E(1, 0, 0), {
      limit: 5,
      filter: { orgId: ['o'], projectId: [], kind: ['summary'] },
    });
    expect(got.map((n) => n.id)).toEqual(['k']);
  });
});
