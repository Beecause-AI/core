// Pure persistence port. MUST NOT import cloud SDKs or adapters (enforced by dependency-cruiser).
export type Neighbor = { id: string; distance: number };

export type VectorPoint = {
  id: string;
  embedding: number[];
  /** equality-restrict tags (namespace → value), e.g. { projectId: 'p1', scope: 'team' } */
  restricts?: Record<string, string>;
};

export interface VectorIndex {
  upsert(points: VectorPoint[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** ANN search. `filter` is namespace → allowed values (AND across namespaces, OR within). */
  findNeighbors(
    embedding: number[],
    opts: { limit: number; filter?: Record<string, string[]> },
  ): Promise<Neighbor[]>;
}
