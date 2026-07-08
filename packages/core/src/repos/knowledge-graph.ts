import type { Db, Store } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import { chunk, getAllDocs } from '../store/query.js';
import type { DocRef } from '../ports/store.js';
import type { KgBuild, KgNode } from '../store/types.js';
import { startOperation } from './operations.js';

/** Node insert shape: required identity/kind fields; nullable columns are optional
 *  (Drizzle `$inferInsert` made the `.notNull()`-less columns optional too). */
export type NewNode =
  & Pick<KgNode, 'orgId' | 'buildId' | 'repoFullName' | 'kind' | 'name'>
  & Partial<Pick<KgNode, 'businessFlow' | 'digest' | 'codeRefPath' | 'codeRefStart' | 'codeRefEnd' | 'commitSha' | 'metadata'>>;
export type NewEdge = Omit<KgEdgeInsert, 'id'>;
type KgEdgeInsert = { id: string; orgId: string; buildId: string; srcNodeId: string; dstNodeId: string; relation: string };
export type BuildMode = 'initial' | 'manual' | 'incremental';

/** One operation per KG build, linked back to the build row via ref_id. */
export async function startBuildOperation(db: Db, build: { id: string; orgId: string; projectId?: string | null }): Promise<string> {
  const op = await startOperation(db, { orgId: build.orgId, projectId: build.projectId ?? null, kind: 'kg-build', refId: build.id });
  return op.id;
}

export async function createBuild(
  db: Db, input: { orgId: string; repoFullName: string; commitSha?: string | null; mode: BuildMode; projectId?: string | null; phase?: string | null },
): Promise<KgBuild> {
  const ref = col(db, 'kg_builds').doc();
  const row = applyDefaults(
    {
      orgId: input.orgId, repoFullName: input.repoFullName, commitSha: input.commitSha ?? null,
      mode: input.mode, status: 'running',
      projectId: input.projectId ?? null,
      phase: input.phase ?? null,
      nodesAnalyzed: 0, tokens: 0, costCredits: 0, truncated: false,
      note: null as string | null, error: null as string | null,
      startedAt: new Date(), finishedAt: null as Date | null,
    },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<KgBuild>(await ref.get());
}

export async function finishBuild(
  db: Db, buildId: string,
  fields: { status: 'done' | 'error'; nodesAnalyzed?: number; tokens?: number; costCredits?: number; truncated?: boolean; note?: string | null; error?: string | null },
): Promise<void> {
  // Only include counter/flag fields when explicitly provided so that callers that
  // omit them (e.g. finalize after per-phase addBuildTokens accumulation) do not
  // accidentally overwrite the accumulated values with zeroes/false. toDoc strips
  // undefined, so an omitted optional field is left untouched in Firestore.
  const set: Record<string, unknown> = {
    status: fields.status,
    note: fields.note ?? null,
    error: fields.error ?? null,
    finishedAt: FieldValue.serverTimestamp(),
    nodesAnalyzed: fields.nodesAnalyzed,
    tokens: fields.tokens,
    costCredits: fields.costCredits,
    truncated: fields.truncated,
  };
  await col(db, 'kg_builds').doc(buildId).update(toDoc(set));
}

export async function insertNodes(db: Db, nodes: NewNode[]): Promise<KgNode[]> {
  if (nodes.length === 0) return [];
  const out: KgNode[] = [];
  const refs: { ref: DocRef; row: KgNode }[] = [];
  for (const n of nodes) {
    const ref = col(db, 'kg_nodes').doc();
    const row = applyDefaults({ businessFlow: null, digest: null, codeRefPath: null, codeRefStart: null, codeRefEnd: null, commitSha: null, metadata: null, ...n }, ref.id) as unknown as KgNode;
    refs.push({ ref, row });
  }
  for (const batchItems of chunk(refs, 500)) {
    const batch = db.batch();
    for (const { ref, row } of batchItems) batch.set(ref, toDoc(row));
    await batch.commit();
  }
  for (const { row } of refs) out.push(row);
  return out;
}

export async function insertEdges(db: Db, edges: NewEdge[]): Promise<void> {
  if (edges.length === 0) return;
  const items = edges.map((e) => {
    const ref = col(db, 'kg_edges').doc();
    return { ref, row: applyDefaults(e as Record<string, unknown>, ref.id) };
  });
  for (const batchItems of chunk(items, 500)) {
    const batch = db.batch();
    for (const { ref, row } of batchItems) batch.set(ref, toDoc(row));
    await batch.commit();
  }
}

/**
 * Delete all nodes of the given kinds for a build, plus any edges touching them.
 * Lets a phase that owns specific node kinds (e.g. `component`) clear its prior
 * output before re-inserting, so a redelivered phase is idempotent. Edges where
 * either endpoint is a deleted node are removed first.
 */
export async function deleteBuildNodesByKind(db: Db, buildId: string, kinds: string[]): Promise<void> {
  if (kinds.length === 0) return;
  const ids: string[] = [];
  for (const kindChunk of chunk(kinds, 30)) {
    const snaps = await col(db, 'kg_nodes').where('buildId', '==', buildId).where('kind', 'in', kindChunk).get();
    for (const s of snaps) ids.push(s.id);
  }
  if (ids.length === 0) return;

  // Edges where either endpoint is a deleted node, within this build.
  const edgeRefIds = new Set<string>();
  for (const idChunk of chunk(ids, 30)) {
    const [srcSnaps, dstSnaps] = await Promise.all([
      col(db, 'kg_edges').where('buildId', '==', buildId).where('srcNodeId', 'in', idChunk).get(),
      col(db, 'kg_edges').where('buildId', '==', buildId).where('dstNodeId', 'in', idChunk).get(),
    ]);
    for (const s of srcSnaps) edgeRefIds.add(s.id);
    for (const s of dstSnaps) edgeRefIds.add(s.id);
  }
  await batchDelete(db, 'kg_edges', [...edgeRefIds]);
  await batchDelete(db, 'kg_nodes', ids);
}

/** Batched delete of docs by id within a collection (≤500 ops/batch). */
async function batchDelete(db: Db, collection: 'kg_edges' | 'kg_nodes' | 'kg_node_embeddings', ids: string[]): Promise<void> {
  for (const idChunk of chunk(ids, 500)) {
    const batch = db.batch();
    for (const id of idChunk) batch.delete(col(db, collection).doc(id));
    await batch.commit();
  }
}

/**
 * Insert embeddings. Writes the embedding both to the `kg_node_embeddings`
 * Firestore doc (id = nodeId, mirroring the old PK) AND to the vector index so
 * semantic search (`findFlowBySemantic`) can find it via ANN. Restricts scope the
 * search the way the old `WHERE build_id = ...` did.
 * SIGNATURE CHANGE: `db: Db` → `store: Store` (needs the vector index).
 */
export async function insertEmbeddings(store: Store, rows: { nodeId: string; buildId: string; embedding: number[] }[]): Promise<void> {
  if (rows.length === 0) return;
  const items = rows.map((r) => ({ ref: col(store.db, 'kg_node_embeddings').doc(r.nodeId), row: r }));
  for (const batchItems of chunk(items, 500)) {
    const batch = store.db.batch();
    for (const { ref, row } of batchItems) batch.set(ref, toDoc(row));
    await batch.commit();
  }
  await store.vector.upsert(rows.map((r) => ({ id: r.nodeId, embedding: r.embedding, restricts: { buildId: r.buildId, kind: 'kg' } })));
}

/**
 * Delete all embeddings for a build. Used by the finalize phase for idempotency
 * before re-inserting. Removes the vector-index datapoints too.
 * SIGNATURE CHANGE: `db: Db` → `store: Store` (needs the vector index).
 */
export async function deleteBuildEmbeddings(store: Store, buildId: string): Promise<void> {
  const snaps = await col(store.db, 'kg_node_embeddings').where('buildId', '==', buildId).get();
  const ids = snaps.map((d) => d.id);
  if (ids.length === 0) return;
  await batchDelete(store.db, 'kg_node_embeddings', ids);
  await store.vector.remove(ids);
}

export async function updateNodeDigests(db: Db, rows: { nodeId: string; digest: string }[]): Promise<void> {
  for (const r of rows) {
    await col(db, 'kg_nodes').doc(r.nodeId).update(toDoc({ digest: r.digest }));
  }
}

/** The most recent build row for a repo (any status), or null. */
export async function getLatestBuild(db: Db, orgId: string, repoFullName: string): Promise<KgBuild | null> {
  const snaps = await col(db, 'kg_builds')
    .where('orgId', '==', orgId).where('repoFullName', '==', repoFullName)
    .orderBy('startedAt', 'desc').limit(1).get();
  return snaps.length === 0 ? null : fromDoc<KgBuild>(snaps[0]!);
}

/** The current build for a repo = the most recently finished successful build. */
export async function getCurrentBuildId(db: Db, orgId: string, repoFullName: string): Promise<string | null> {
  const snaps = await col(db, 'kg_builds')
    .where('orgId', '==', orgId).where('repoFullName', '==', repoFullName).where('status', '==', 'done')
    .orderBy('finishedAt', 'desc').orderBy('startedAt', 'desc').limit(1).get();
  return snaps.length === 0 ? null : snaps[0]!.id;
}

export interface GraphNode { id: string; kind: string; name: string; businessFlow: string | null; digest: string | null; metadata: Record<string, unknown> | null; repoFullName: string }
export interface GraphEdge { src: string; dst: string; relation: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

async function graphForBuild(db: Db, buildId: string): Promise<Graph> {
  const [nodeSnaps, edgeSnaps] = await Promise.all([
    col(db, 'kg_nodes').where('buildId', '==', buildId).get(),
    col(db, 'kg_edges').where('buildId', '==', buildId).get(),
  ]);
  const nodes: GraphNode[] = nodeSnaps.map((d) => {
    const n = fromDoc<KgNode>(d);
    return { id: n.id, kind: n.kind, name: n.name, businessFlow: n.businessFlow, digest: n.digest, metadata: n.metadata ?? null, repoFullName: n.repoFullName };
  });
  const edges: GraphEdge[] = edgeSnaps.map((d) => {
    const e = fromDoc<KgEdgeInsert>(d);
    return { src: e.srcNodeId, dst: e.dstNodeId, relation: e.relation };
  });
  return { nodes, edges };
}

/** The current ("done") build's full node + edge set for a repo, for visualization.
 *  Empty graph when the repo has no completed build. Pure DB read, no LLM. */
export async function getGraph(db: Db, orgId: string, repoFullName: string): Promise<Graph> {
  const buildId = await getCurrentBuildId(db, orgId, repoFullName);
  if (!buildId) return { nodes: [], edges: [] };
  return graphForBuild(db, buildId);
}

/** Update the phase of a build. */
export async function setBuildPhase(db: Db, buildId: string, phase: string): Promise<void> {
  await col(db, 'kg_builds').doc(buildId).update(toDoc({ phase }));
}

/** Accumulate `n` tokens onto a build's running total (per-phase metering). No-op for n<=0. */
export async function addBuildTokens(db: Db, buildId: string, n: number): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) return;
  await col(db, 'kg_builds').doc(buildId).update({ tokens: FieldValue.increment(n) });
}

/** The most recent build for a project (any status), including running builds. */
export async function getLatestProjectBuild(db: Db, orgId: string, projectId: string): Promise<KgBuild | null> {
  const snaps = await col(db, 'kg_builds')
    .where('orgId', '==', orgId).where('projectId', '==', projectId)
    .orderBy('startedAt', 'desc').limit(1).get();
  return snaps.length === 0 ? null : fromDoc<KgBuild>(snaps[0]!);
}

/** Returns true if the given buildId belongs to the given projectId. */
export async function buildBelongsToProject(db: Db, buildId: string, projectId: string): Promise<boolean> {
  const snap = await col(db, 'kg_builds').doc(buildId).get();
  return snap.exists && snap.data()?.projectId === projectId;
}

/** The current project-scoped build = the most recently finished successful build matching orgId + projectId. */
export async function getCurrentProjectBuildId(db: Db, orgId: string, projectId: string): Promise<string | null> {
  const snaps = await col(db, 'kg_builds')
    .where('orgId', '==', orgId).where('projectId', '==', projectId).where('status', '==', 'done')
    .orderBy('finishedAt', 'desc').orderBy('startedAt', 'desc').limit(1).get();
  return snaps.length === 0 ? null : snaps[0]!.id;
}

/** The current project build's full node + edge set spanning all repos, for visualization. */
export async function getProjectGraph(db: Db, orgId: string, projectId: string): Promise<Graph> {
  const buildId = await getCurrentProjectBuildId(db, orgId, projectId);
  if (!buildId) return { nodes: [], edges: [] };
  return graphForBuild(db, buildId);
}

/** Business-flow nodes of the current project build, ordered by name. */
export async function getProjectFlows(db: Db, orgId: string, projectId: string): Promise<KgNode[]> {
  const buildId = await getCurrentProjectBuildId(db, orgId, projectId);
  if (!buildId) return [];
  const snaps = await col(db, 'kg_nodes')
    .where('buildId', '==', buildId).where('kind', '==', 'flow')
    .orderBy('name', 'asc').get();
  return snaps.map((d) => fromDoc<KgNode>(d));
}

/** Nodes reachable by outgoing edges from nodeId whose relation is in relations, ordered by name. */
export async function getChildren(db: Db, nodeId: string, relations: string[]): Promise<KgNode[]> {
  if (relations.length === 0) return [];
  return edgeTraversal(db, nodeId, relations, 'srcNodeId', 'dstNodeId');
}

/** Nodes that have an outgoing edge to nodeId whose relation is in relations, ordered by name. */
export async function getParents(db: Db, nodeId: string, relations: string[]): Promise<KgNode[]> {
  if (relations.length === 0) return [];
  return edgeTraversal(db, nodeId, relations, 'dstNodeId', 'srcNodeId');
}

/** Shared edge→node traversal: edges where `fromField`==nodeId & relation∈relations,
 *  collect `toField`, getAll nodes, return ordered by name (mirrors innerJoin + orderBy). */
async function edgeTraversal(
  db: Db, nodeId: string, relations: string[],
  fromField: 'srcNodeId' | 'dstNodeId', toField: 'srcNodeId' | 'dstNodeId',
): Promise<KgNode[]> {
  const targetIds = new Set<string>();
  for (const relChunk of chunk(relations, 30)) {
    const snaps = await col(db, 'kg_edges').where(fromField, '==', nodeId).where('relation', 'in', relChunk).get();
    for (const s of snaps) targetIds.add(s.data()?.[toField] as string);
  }
  if (targetIds.size === 0) return [];
  const nodeSnaps = await getAllDocs(db, 'kg_nodes', [...targetIds]);
  return nodeSnaps.map((s) => fromDoc<KgNode>(s)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Business-flow nodes of the current build. */
export async function getFlows(db: Db, orgId: string, repoFullName: string): Promise<KgNode[]> {
  const buildId = await getCurrentBuildId(db, orgId, repoFullName);
  if (!buildId) return [];
  const snaps = await col(db, 'kg_nodes')
    .where('buildId', '==', buildId).where('kind', '==', 'flow')
    .orderBy('name', 'asc').get();
  return snaps.map((d) => fromDoc<KgNode>(d));
}

export async function getNode(db: Db, nodeId: string): Promise<KgNode | null> {
  const snap = await col(db, 'kg_nodes').doc(nodeId).get();
  return snap.exists ? fromDoc<KgNode>(snap) : null;
}

/** A flow node plus the nodes that implement it (via implements_flow edges). */
export async function walkthrough(db: Db, flowId: string): Promise<{ flow: KgNode; nodes: KgNode[] } | null> {
  const flow = await getNode(db, flowId);
  if (!flow) return null;
  const snaps = await col(db, 'kg_edges')
    .where('srcNodeId', '==', flowId).where('relation', '==', 'implements_flow').where('buildId', '==', flow.buildId)
    .get();
  const dstIds = [...new Set(snaps.map((d) => d.data()?.dstNodeId as string))];
  const nodeSnaps = await getAllDocs(db, 'kg_nodes', dstIds);
  const nodes = nodeSnaps.map((s) => fromDoc<KgNode>(s)).sort((a, b) => a.name.localeCompare(b.name));
  return { flow, nodes };
}

/** Nearest nodes to a query embedding, within the repo's current build.
 *  SIGNATURE CHANGE: `db: Db` → `store: Store` (vector search via Vertex/InMemory index). */
export async function findFlowBySemantic(
  store: Store, orgId: string, repoFullName: string, queryEmbedding: number[], limit = 5,
): Promise<KgNode[]> {
  const buildId = await getCurrentBuildId(store.db, orgId, repoFullName);
  if (!buildId) return [];
  const neighbors = await store.vector.findNeighbors(queryEmbedding, { limit, filter: { buildId: [buildId] } });
  if (neighbors.length === 0) return [];
  // Embedding datapoint id === nodeId; fetch nodes and re-sort by neighbor (distance) order.
  const order = new Map(neighbors.map((n, i) => [n.id, i]));
  const nodeSnaps = await getAllDocs(store.db, 'kg_nodes', neighbors.map((n) => n.id));
  return nodeSnaps
    .map((s) => fromDoc<KgNode>(s))
    .sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
}

/** Caller must ensure nodeId belongs to the requesting org (no org check here). */
/** Nodes within K hops of nodeId whose commitSha differs from their build's commit. */
export async function recentChangesNear(db: Db, nodeId: string, depth = 1): Promise<KgNode[]> {
  const start = await getNode(db, nodeId);
  if (!start) return [];
  const buildSnap = await col(db, 'kg_builds').doc(start.buildId).get();
  const buildSha = (buildSnap.exists ? (buildSnap.data()?.commitSha as string | null) : null) ?? null;
  const near = [
    ...(await blastRadius(db, nodeId, 'downstream', depth)),
    ...(await blastRadius(db, nodeId, 'upstream', depth)),
  ];
  const byId = new Map(near.map((n) => [n.id, n] as const));
  return [...byId.values()].filter((n) => n.commitSha && n.commitSha !== buildSha);
}

/** Caller must ensure nodeId belongs to the requesting org (no org check here). */
/** Traverse edges up/down from a node, up to `depth` hops. Returns reached nodes (excl. the start). */
export async function blastRadius(db: Db, nodeId: string, direction: 'upstream' | 'downstream', depth: number): Promise<KgNode[]> {
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let i = 0; i < depth && frontier.length > 0; i++) {
    const fromField = direction === 'downstream' ? 'srcNodeId' : 'dstNodeId';
    const toField = direction === 'downstream' ? 'dstNodeId' : 'srcNodeId';
    const reached: string[] = [];
    for (const idChunk of chunk(frontier, 30)) {
      const snaps = await col(db, 'kg_edges').where(fromField, 'in', idChunk).get();
      for (const s of snaps) reached.push(s.data()?.[toField] as string);
    }
    const next = reached.filter((id) => !seen.has(id));
    next.forEach((id) => seen.add(id));
    frontier = [...new Set(next)];
  }
  const ids = [...seen].filter((id) => id !== nodeId);
  if (ids.length === 0) return [];
  const nodeSnaps = await getAllDocs(db, 'kg_nodes', ids);
  return nodeSnaps.map((s) => fromDoc<KgNode>(s));
}
