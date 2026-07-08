import type { Neighbor, VectorIndex, VectorPoint } from '../../ports/vector.js';

/** Exact cosine over an in-memory map — for tests and the local emulator
 *  (Vertex Vector Search has no emulator). Behaviour matches pgvector ordering closely. */
export class InMemoryVectorIndex implements VectorIndex {
  private pts = new Map<string, { e: number[]; r: Record<string, string> }>();

  async upsert(points: VectorPoint[]): Promise<void> {
    for (const p of points) this.pts.set(p.id, { e: p.embedding, r: p.restricts ?? {} });
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) this.pts.delete(id);
  }

  async findNeighbors(
    q: number[],
    opts: { limit: number; filter?: Record<string, string[]> },
  ): Promise<Neighbor[]> {
    const matches = (r: Record<string, string>) =>
      !opts.filter ||
      Object.entries(opts.filter).every(([k, vs]) => vs.length === 0 || vs.includes(r[k]!));
    return [...this.pts]
      .filter(([, v]) => matches(v.r))
      .map(([id, v]) => ({ id, distance: 1 - cosine(q, v.e) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, opts.limit);
  }
}

/** No-op index used when vector search is not provisioned — recall/upsert/remove become inert. */
export class DisabledVectorIndex implements VectorIndex {
  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}
  async findNeighbors(): Promise<Neighbor[]> {
    return [];
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
