import { Firestore } from '@google-cloud/firestore';
import type { Db, Store } from '@intellilabs/core';
import { FirestoreStore } from '../../../packages/core/src/adapters/store/firestore.js';
import type { Query } from '../../../packages/core/src/ports/store.js';
import type { GraphBuilderConfig } from '../src/config.js';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

let counter = 0;

/** Minimal in-memory vector index for tests. The KG phases only `upsert`/`remove`
 *  during finalize and read embeddings back from the `kg_node_embeddings` Firestore
 *  collection (not the index), so neighbour search is never exercised here. */
class StubVectorIndex {
  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}
  async findNeighbors(): Promise<{ id: string; distance: number }[]> { return []; }
}

/**
 * A throwaway Firestore-emulator store, isolated by a unique projectId so collections
 * never collide across concurrent test runs against the shared emulator
 * (FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; `make dev-up`).
 *
 * Returns `{ db, store, stop }`: `db` is the DocStore port (assertions + repos consume it),
 * `store` is the full Store the phases need (vector index for finalize), and `stop()` wipes
 * every collection then terminates the client.
 */
export async function startTestDb(): Promise<{ db: Db; store: Store; stop: () => Promise<void> }> {
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  const projectId = `test-gb-${process.pid}-${counter++}`;
  const raw = new Firestore({ projectId });
  const store: Store = { db: new FirestoreStore(raw), vector: new StubVectorIndex(), close: () => raw.terminate() };
  return {
    db: store.db,
    store,
    async stop() {
      await wipeRaw(raw);
      await raw.terminate();
    },
  };
}

/** Delete every document in every collection of a test store. Operates on the raw Firestore
 *  handle (collection enumeration is not part of the DocStore port). */
async function wipeRaw(db: Firestore): Promise<void> {
  const cols = await db.listCollections();
  for (const c of cols) {
    const docs = await c.listDocuments();
    await Promise.all(docs.map((d) => d.delete()));
  }
}

// ── Firestore read helpers for assertions (replace the old drizzle `db.select()`) ──

export type NodeRow = {
  id: string;
  orgId: string;
  buildId: string;
  repoFullName: string;
  kind: string;
  name: string;
  businessFlow: string | null;
  digest: string | null;
  commitSha: string | null;
  metadata: Record<string, unknown> | null;
};

export type EdgeRow = { id: string; buildId: string; srcNodeId: string; dstNodeId: string; relation: string };

export type BuildRow = {
  id: string;
  orgId: string;
  projectId: string | null;
  phase: string | null;
  status: string;
  tokens: number;
  nodesAnalyzed: number;
  finishedAt: unknown;
};

/** All nodes for a build (optionally filtered by kind). */
export async function selectNodes(db: Db, buildId: string, kind?: string): Promise<NodeRow[]> {
  let q: Query = db.collection('kg_nodes').where('buildId', '==', buildId);
  if (kind != null) q = q.where('kind', '==', kind);
  const snaps = await q.get();
  return snaps.map((d) => ({ id: d.id, ...(d.data() as Omit<NodeRow, 'id'>) }));
}

/** All edges for a build (optionally filtered by relation and/or src node). */
export async function selectEdges(
  db: Db,
  buildId: string,
  opts: { relation?: string; srcNodeId?: string } = {},
): Promise<EdgeRow[]> {
  let q: Query = db.collection('kg_edges').where('buildId', '==', buildId);
  if (opts.relation != null) q = q.where('relation', '==', opts.relation);
  if (opts.srcNodeId != null) q = q.where('srcNodeId', '==', opts.srcNodeId);
  const snaps = await q.get();
  return snaps.map((d) => ({ id: d.id, ...(d.data() as Omit<EdgeRow, 'id'>) }));
}

/** The single build matching org (+ optional project), or undefined. */
export async function selectBuild(
  db: Db,
  opts: { id?: string; orgId?: string; projectId?: string },
): Promise<BuildRow | undefined> {
  if (opts.id != null) {
    const snap = await db.collection('kg_builds').doc(opts.id).get();
    return snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<BuildRow, 'id'>) }) : undefined;
  }
  let q: Query = db.collection('kg_builds');
  if (opts.orgId != null) q = q.where('orgId', '==', opts.orgId);
  if (opts.projectId != null) q = q.where('projectId', '==', opts.projectId);
  const snaps = await q.get();
  const d = snaps[0];
  return d ? ({ id: d.id, ...(d.data() as Omit<BuildRow, 'id'>) }) : undefined;
}

/** All embedding docs for a build. */
export async function selectEmbeddings(
  db: Db,
  buildId: string,
): Promise<{ nodeId: string; buildId: string; embedding: number[] }[]> {
  const snaps = await db.collection('kg_node_embeddings').where('buildId', '==', buildId).get();
  return snaps.map((d) => d.data() as { nodeId: string; buildId: string; embedding: number[] });
}

export type InvocationRow = { id: string; orgId: string | null; source: string; operationId: string | null };

/** model_invocations whose `source` starts with the given prefix (replaces drizzle `like('…%')`). */
export async function selectInvocationsBySourcePrefix(db: Db, prefix: string): Promise<InvocationRow[]> {
  const snaps = await db.collection('model_invocations').get();
  return snaps
    .map((d) => ({ id: d.id, ...(d.data() as Omit<InvocationRow, 'id'>) }))
    .filter((r) => typeof r.source === 'string' && r.source.startsWith(prefix));
}

export type OperationRow = {
  id: string;
  refId: string | null;
  status: string;
  error: string | null;
  runConversationId: string | null;
  parentConversationId: string | null;
};

/** operations matching a refId (replaces drizzle `where(eq(operations.refId, …))`). */
export async function selectOperationsByRefId(db: Db, refId: string): Promise<OperationRow[]> {
  const snaps = await db.collection('operations').where('refId', '==', refId).get();
  return snaps.map((d) => ({ id: d.id, ...(d.data() as Omit<OperationRow, 'id'>) }));
}

/** Config shaped like the real loadConfig() output but pointed at the emulator. */
export const testConfig: GraphBuilderConfig = {
  GCP_PROJECT_ID: 'test-gb',
  FIRESTORE_EMULATOR_HOST: HOST,
  VECTOR_LOCATION: 'us-central1',
  VECTOR_INDEX_ID: '',
  VECTOR_INDEX_ENDPOINT_ID: '',
  VECTOR_DEPLOYED_INDEX_ID: '',
  PORT: 8080,
  NODE_ENV: 'test',
  VERTEX_LOCATION: 'global',
};
