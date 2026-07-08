// Back-compat barrel. The port now lives in ../ports/vector.js; adapters in ../adapters/vector/*.
// Kept so existing `./vector.js` importers (e.g. store/firestore.ts) don't change.
export type { Neighbor, VectorPoint, VectorIndex } from '../ports/vector.js';
export { InMemoryVectorIndex, DisabledVectorIndex } from '../adapters/vector/in-memory.js';
export { VertexVectorIndex, vectorConfigured, type VertexVectorConfig } from '../adapters/vector/vertex.js';
export { FirestoreVectorIndex } from '../adapters/vector/firestore.js';
