import { Firestore, FieldValue, type Query } from '@google-cloud/firestore';
import type { Neighbor, VectorIndex, VectorPoint } from '../../ports/vector.js';

/** Firestore native vector search (`findNearest` KNN). Each point is one doc in `vector_points`. */
export class FirestoreVectorIndex implements VectorIndex {
  private static readonly BATCH = 450;

  constructor(private db: Firestore) {}

  async upsert(points: VectorPoint[]): Promise<void> {
    for (let i = 0; i < points.length; i += FirestoreVectorIndex.BATCH) {
      const batch = this.db.batch();
      for (const p of points.slice(i, i + FirestoreVectorIndex.BATCH)) {
        batch.set(this.db.collection('vector_points').doc(p.id), {
          embedding: FieldValue.vector(p.embedding),
          ...(p.restricts ?? {}),
        });
      }
      await batch.commit();
    }
  }

  async remove(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += FirestoreVectorIndex.BATCH) {
      const batch = this.db.batch();
      for (const id of ids.slice(i, i + FirestoreVectorIndex.BATCH)) {
        batch.delete(this.db.collection('vector_points').doc(id));
      }
      await batch.commit();
    }
  }

  async findNeighbors(
    embedding: number[],
    opts: { limit: number; filter?: Record<string, string[]> },
  ): Promise<Neighbor[]> {
    let q: Query = this.db.collection('vector_points');
    for (const [ns, values] of Object.entries(opts.filter ?? {})) {
      if (values.length === 0) continue;
      q = values.length === 1 ? q.where(ns, '==', values[0]) : q.where(ns, 'in', values);
    }
    const snap = await q
      .findNearest({
        vectorField: 'embedding',
        queryVector: FieldValue.vector(embedding),
        limit: opts.limit,
        distanceMeasure: 'COSINE',
        distanceResultField: '_d',
      })
      .get();
    return snap.docs.map((d) => ({ id: d.id, distance: d.get('_d') as number }));
  }
}
