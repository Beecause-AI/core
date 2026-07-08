import { describe, it, expect } from 'vitest';
import { DisabledVectorIndex, VertexVectorIndex, FirestoreVectorIndex, vectorConfigured, type VectorIndex, type VertexVectorConfig } from '../../src/store/vector.js';
import { createStore } from '../../src/store/firestore.js';

const FULL: VertexVectorConfig = {
  location: 'us-central1',
  indexId: 'idx',
  indexEndpointId: 'ep',
  deployedIndexId: 'dep',
};

describe('vectorConfigured', () => {
  it('is true only when every field is present', () => {
    expect(vectorConfigured(FULL)).toBe(true);
  });

  it('is false when any field is the empty string (the unprovisioned-infra case)', () => {
    // Infra injects empty strings (not undefined) when enableVectorSearch is off; zod `.default`
    // therefore does not apply, which previously produced a `-aiplatform.googleapis.com` host.
    expect(vectorConfigured({ ...FULL, location: '' })).toBe(false);
    expect(vectorConfigured({ ...FULL, indexEndpointId: '' })).toBe(false);
    expect(vectorConfigured({ ...FULL, indexId: '' })).toBe(false);
    expect(vectorConfigured({ ...FULL, deployedIndexId: '' })).toBe(false);
  });
});

describe('DisabledVectorIndex', () => {
  it('recall is inert — returns no neighbours and never touches the network', async () => {
    const v: VectorIndex = new DisabledVectorIndex();
    await expect(v.findNeighbors([0.1, 0.2], { limit: 5 })).resolves.toEqual([]);
    // upsert/remove are no-ops, not rejections
    await expect(v.upsert([{ id: 'a', embedding: [0.1] }])).resolves.toBeUndefined();
    await expect(v.remove(['a'])).resolves.toBeUndefined();
  });
});

describe('createStore vector backend selection', () => {
  // emulatorHost keeps construction offline; no query is issued so close() is enough teardown.
  const base = { projectId: 'sel-test', emulatorHost: '127.0.0.1:8080' } as const;

  it('selects FirestoreVectorIndex when firestoreVector is true', async () => {
    const store = createStore({ ...base, firestoreVector: true, vector: FULL });
    expect(store.vector).toBeInstanceOf(FirestoreVectorIndex);
    await store.close();
  });

  it('falls back to VertexVectorIndex when Vertex is configured and firestoreVector is unset', async () => {
    const store = createStore({ ...base, vector: FULL });
    expect(store.vector).toBeInstanceOf(VertexVectorIndex);
    await store.close();
  });

  it('uses DisabledVectorIndex when neither is configured', async () => {
    const store = createStore({ ...base, vector: { ...FULL, indexId: '' } });
    expect(store.vector).toBeInstanceOf(DisabledVectorIndex);
    await store.close();
  });
});
