import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import {
  createBuild, finishBuild, insertNodes, insertEdges, deleteBuildNodesByKind,
  insertEmbeddings, deleteBuildEmbeddings, updateNodeDigests,
  getCurrentBuildId, getCurrentProjectBuildId, getLatestBuild, getLatestProjectBuild, buildBelongsToProject,
  getFlows, getProjectFlows, getNode, walkthrough, blastRadius, recentChangesNear,
  findFlowBySemantic, getGraph, getProjectGraph, getChildren, getParents,
  setBuildPhase, addBuildTokens,
} from '../../src/repos/knowledge-graph.js';

const store = testStore('knowledge-graph');
const db = store.db;

beforeEach(async () => {
  await wipe(db);
  (store.vector as any).pts?.clear?.();
});
afterAll(() => store.close());

// 3-d embeddings keep cosine ranking deterministic and the test fast.
const E = (a: number, b: number, c: number) => [a, b, c];

describe('createBuild / finishBuild', () => {
  it('creates a running build with default counters', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'o/web', commitSha: 'c1', mode: 'manual' });
    expect(b.status).toBe('running');
    expect(b.tokens).toBe(0);
    expect(b.nodesAnalyzed).toBe(0);
    expect(b.costCredits).toBe(0);
    expect(b.truncated).toBe(false);
    expect(b.commitSha).toBe('c1');
    expect(b.finishedAt).toBeNull();
    expect(b.startedAt).toBeInstanceOf(Date);
  });

  it('becomes current only once finished done', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'o/web', commitSha: 'c1', mode: 'manual' });
    expect(await getCurrentBuildId(db, 'o', 'o/web')).toBeNull();
    await finishBuild(db, b.id, { status: 'done', nodesAnalyzed: 2, tokens: 0, costCredits: 0 });
    expect(await getCurrentBuildId(db, 'o', 'o/web')).toBe(b.id);
  });

  it('a newer done build supersedes the previous current build', async () => {
    const b1 = await createBuild(db, { orgId: 'o', repoFullName: 'sup/web', commitSha: 'v1', mode: 'manual' });
    await insertNodes(db, [{ orgId: 'o', buildId: b1.id, repoFullName: 'sup/web', kind: 'flow', name: 'old-flow', commitSha: 'v1' }]);
    await finishBuild(db, b1.id, { status: 'done' });
    expect(await getCurrentBuildId(db, 'o', 'sup/web')).toBe(b1.id);
    expect((await getFlows(db, 'o', 'sup/web')).map((f) => f.name)).toEqual(['old-flow']);

    const b2 = await createBuild(db, { orgId: 'o', repoFullName: 'sup/web', commitSha: 'v2', mode: 'manual' });
    await insertNodes(db, [{ orgId: 'o', buildId: b2.id, repoFullName: 'sup/web', kind: 'flow', name: 'new-flow', commitSha: 'v2' }]);
    await finishBuild(db, b2.id, { status: 'done' });
    expect(await getCurrentBuildId(db, 'o', 'sup/web')).toBe(b2.id);
    expect((await getFlows(db, 'o', 'sup/web')).map((f) => f.name)).toEqual(['new-flow']);
  });

  it('getLatestBuild returns the most recent regardless of status', async () => {
    const b1 = await createBuild(db, { orgId: 'o', repoFullName: 'l/web', commitSha: 'l1', mode: 'manual' });
    await finishBuild(db, b1.id, { status: 'done' });
    const b2 = await createBuild(db, { orgId: 'o', repoFullName: 'l/web', commitSha: 'l2', mode: 'manual' });
    const latest = await getLatestBuild(db, 'o', 'l/web');
    expect(latest!.id).toBe(b2.id);
    expect(latest!.status).toBe('running');
    expect(await getLatestBuild(db, 'o', 'none/repo')).toBeNull();
  });
});

describe('addBuildTokens + finishBuild counter preservation', () => {
  const tokensOf = async (id: string) => (await col(db, 'kg_builds').doc(id).get()).data()?.tokens;

  it('accumulates tokens and ignores non-positive deltas', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 't/web', commitSha: 't1', mode: 'manual' });
    expect(await tokensOf(b.id)).toBe(0);
    await addBuildTokens(db, b.id, 15);
    expect(await tokensOf(b.id)).toBe(15);
    await addBuildTokens(db, b.id, 10);
    expect(await tokensOf(b.id)).toBe(25);
    await addBuildTokens(db, b.id, 0);
    await addBuildTokens(db, b.id, -5);
    expect(await tokensOf(b.id)).toBe(25);
  });

  it('finishBuild without tokens preserves accumulation; with tokens overrides', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'fb/web', commitSha: 'fb1', mode: 'manual' });
    await addBuildTokens(db, b.id, 60);
    await addBuildTokens(db, b.id, 40);
    await finishBuild(db, b.id, { status: 'done', nodesAnalyzed: 5 });
    let row = (await col(db, 'kg_builds').doc(b.id).get()).data()!;
    expect(row.tokens).toBe(100);
    expect(row.nodesAnalyzed).toBe(5);
    expect(row.status).toBe('done');

    const b2 = await createBuild(db, { orgId: 'o', repoFullName: 'fb2/web', commitSha: 'fb2', mode: 'manual' });
    await addBuildTokens(db, b2.id, 50);
    await finishBuild(db, b2.id, { status: 'done', tokens: 200, nodesAnalyzed: 3 });
    row = (await col(db, 'kg_builds').doc(b2.id).get()).data()!;
    expect(row.tokens).toBe(200);
    expect(row.nodesAnalyzed).toBe(3);
  });
});

describe('nodes + edges traversal', () => {
  it('bulk inserts nodes & edges, exposes flows/node/walkthrough/blastRadius', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'q/web', commitSha: 'c1', mode: 'manual' });
    const [flow, api, dbnode] = await insertNodes(db, [
      { orgId: 'o', buildId: b.id, repoFullName: 'q/web', kind: 'flow', name: 'checkout', digest: 'Checkout', commitSha: 'c1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'q/web', kind: 'endpoint', name: 'POST /checkout', codeRefPath: 'src/api.ts', commitSha: 'c1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'q/web', kind: 'db_table', name: 'orders', commitSha: 'c1' },
    ]);
    await insertEdges(db, [
      { orgId: 'o', buildId: b.id, srcNodeId: flow!.id, dstNodeId: api!.id, relation: 'implements_flow' },
      { orgId: 'o', buildId: b.id, srcNodeId: api!.id, dstNodeId: dbnode!.id, relation: 'writes_table' },
    ]);
    await finishBuild(db, b.id, { status: 'done' });

    expect((await getFlows(db, 'o', 'q/web')).map((f) => f.name)).toEqual(['checkout']);
    expect((await getNode(db, api!.id))?.name).toBe('POST /checkout');
    expect(await getNode(db, '00000000-0000-0000-0000-000000000000')).toBeNull();

    const wt = await walkthrough(db, flow!.id);
    expect(wt!.flow.name).toBe('checkout');
    expect(wt!.nodes.map((n) => n.name)).toContain('POST /checkout');

    const down = await blastRadius(db, api!.id, 'downstream', 2);
    expect(down.map((n) => n.name)).toContain('orders');
    const up = await blastRadius(db, dbnode!.id, 'upstream', 2);
    expect(up.map((n) => n.name)).toContain('POST /checkout');
  });

  it('getChildren / getParents follow edge direction and order by name', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'o/a', commitSha: 'p1', mode: 'manual', projectId: 'proj' });
    const [compC, fileF1, fileF2, flowFL, datastoreD] = await insertNodes(db, [
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'component', name: 'CompC', commitSha: 'p1', metadata: { x: 1 } },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'file', name: 'FileF1', commitSha: 'p1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/b', kind: 'file', name: 'FileF2', commitSha: 'p1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'flow', name: 'FlowFL', commitSha: 'p1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'datastore', name: 'DatastoreD', commitSha: 'p1' },
    ]);
    await insertEdges(db, [
      { orgId: 'o', buildId: b.id, srcNodeId: compC!.id, dstNodeId: fileF1!.id, relation: 'composes' },
      { orgId: 'o', buildId: b.id, srcNodeId: compC!.id, dstNodeId: fileF2!.id, relation: 'composes' },
      { orgId: 'o', buildId: b.id, srcNodeId: flowFL!.id, dstNodeId: fileF1!.id, relation: 'implements_flow' },
      { orgId: 'o', buildId: b.id, srcNodeId: compC!.id, dstNodeId: datastoreD!.id, relation: 'depends_on' },
    ]);
    await finishBuild(db, b.id, { status: 'done' });

    expect((await getChildren(db, compC!.id, ['composes'])).map((n) => n.name)).toEqual(['FileF1', 'FileF2']);
    expect((await getChildren(db, compC!.id, ['depends_on'])).map((n) => n.name)).toEqual(['DatastoreD']);
    expect(await getChildren(db, compC!.id, [])).toEqual([]);
    // getParents: incoming traversal
    expect((await getParents(db, fileF1!.id, ['composes'])).map((n) => n.name)).toEqual(['CompC']);
    expect((await getParents(db, fileF1!.id, ['implements_flow'])).map((n) => n.name)).toEqual(['FlowFL']);
    expect(await getParents(db, fileF1!.id, [])).toEqual([]);
  });

  it('updateNodeDigests sets a digest on an existing node', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'd/web', commitSha: 'd1', mode: 'manual' });
    const [file] = await insertNodes(db, [{ orgId: 'o', buildId: b.id, repoFullName: 'd/web', kind: 'file', name: 'pay.ts', codeRefPath: 'src/pay.ts', commitSha: 'd1' }]);
    expect(file!.digest ?? null).toBeNull();
    await updateNodeDigests(db, [{ nodeId: file!.id, digest: 'Handles payment.' }]);
    expect((await getNode(db, file!.id))?.digest).toBe('Handles payment.');
  });
});

describe('getGraph / getProjectGraph', () => {
  it('returns nodes & edges for a completed build, empty otherwise', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'gg/web', commitSha: 'g1', mode: 'manual' });
    const [flowNode, fileNode] = await insertNodes(db, [
      { orgId: 'o', buildId: b.id, repoFullName: 'gg/web', kind: 'flow', name: 'checkout', digest: 'Checkout flow', businessFlow: 'buy something', commitSha: 'g1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'gg/web', kind: 'file', name: 'checkout.ts', codeRefPath: 'src/checkout.ts', commitSha: 'g1' },
    ]);
    await insertEdges(db, [{ orgId: 'o', buildId: b.id, srcNodeId: flowNode!.id, dstNodeId: fileNode!.id, relation: 'implements_flow' }]);
    await finishBuild(db, b.id, { status: 'done' });

    const graph = await getGraph(db, 'o', 'gg/web');
    expect(graph.nodes).toHaveLength(2);
    const flow = graph.nodes.find((n) => n.kind === 'flow');
    expect(flow?.businessFlow).toBe('buy something');
    expect(flow?.digest).toBe('Checkout flow');
    expect(graph.edges).toEqual([{ src: flowNode!.id, dst: fileNode!.id, relation: 'implements_flow' }]);

    expect(await getGraph(db, 'o', 'none/repo')).toEqual({ nodes: [], edges: [] });
  });

  it('project-scoped queries span repos and respect projectId', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'o/a', commitSha: 'p1', mode: 'manual', projectId: 'proj', phase: 'phase1' });
    const [compC, , , flowFL] = await insertNodes(db, [
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'component', name: 'CompC', commitSha: 'p1', metadata: { x: 1 } },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'file', name: 'FileF1', commitSha: 'p1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/b', kind: 'file', name: 'FileF2', commitSha: 'p1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'o/a', kind: 'flow', name: 'FlowFL', commitSha: 'p1' },
    ]);
    await setBuildPhase(db, b.id, 'phase2');
    expect(await getCurrentProjectBuildId(db, 'o', 'proj')).toBeNull();
    await finishBuild(db, b.id, { status: 'done' });

    expect(await getCurrentProjectBuildId(db, 'o', 'proj')).toBe(b.id);
    expect(await getCurrentProjectBuildId(db, 'o', 'other')).toBeNull();

    const graph = await getProjectGraph(db, 'o', 'proj');
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.find((n) => n.kind === 'component')?.metadata).toEqual({ x: 1 });
    expect(new Set(graph.nodes.map((n) => n.repoFullName))).toEqual(new Set(['o/a', 'o/b']));

    expect((await getProjectFlows(db, 'o', 'proj')).map((f) => f.name)).toEqual(['FlowFL']);
    expect(compC && flowFL).toBeTruthy();

    // build/project association helpers
    expect(await buildBelongsToProject(db, b.id, 'proj')).toBe(true);
    expect(await buildBelongsToProject(db, b.id, 'other')).toBe(false);
    expect(await buildBelongsToProject(db, '00000000-0000-0000-0000-000000000000', 'proj')).toBe(false);
    const latest = await getLatestProjectBuild(db, 'o', 'proj');
    expect(latest!.id).toBe(b.id);
    expect(await getLatestProjectBuild(db, 'o', 'empty-proj')).toBeNull();
  });
});

describe('embeddings + vector search', () => {
  it('insertEmbeddings + findFlowBySemantic returns the nearest node', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 's/web', commitSha: 'c2', mode: 'manual' });
    const [checkout, auth, file] = await insertNodes(db, [
      { orgId: 'o', buildId: b.id, repoFullName: 's/web', kind: 'flow', name: 'checkout', commitSha: 'c2' },
      { orgId: 'o', buildId: b.id, repoFullName: 's/web', kind: 'flow', name: 'auth', commitSha: 'c2' },
      { orgId: 'o', buildId: b.id, repoFullName: 's/web', kind: 'file', name: 'pay.ts', codeRefPath: 'src/pay.ts', commitSha: 'NEW' },
    ]);
    await insertEdges(db, [{ orgId: 'o', buildId: b.id, srcNodeId: checkout!.id, dstNodeId: file!.id, relation: 'implements_flow' }]);
    await insertEmbeddings(store, [
      { nodeId: checkout!.id, buildId: b.id, embedding: E(1, 0, 0) },
      { nodeId: auth!.id, buildId: b.id, embedding: E(0, 1, 0) },
    ]);
    await finishBuild(db, b.id, { status: 'done' });

    const near = await findFlowBySemantic(store, 'o', 's/web', E(0.9, 0.1, 0), 1);
    expect(near.map((n) => n.name)).toEqual(['checkout']);

    // no current build → empty
    expect(await findFlowBySemantic(store, 'o', 'none/repo', E(1, 0, 0), 1)).toEqual([]);

    // recentChangesNear finds the changed neighbour (commitSha != build sha)
    const changed = await recentChangesNear(db, checkout!.id, 1);
    expect(changed.map((n) => n.name)).toContain('pay.ts');
  });

  it('deleteBuildEmbeddings clears one build, leaves others & drops vector points', async () => {
    const b1 = await createBuild(db, { orgId: 'o', repoFullName: 'e/web', commitSha: 'e1', mode: 'manual' });
    const b2 = await createBuild(db, { orgId: 'o', repoFullName: 'e/web', commitSha: 'e2', mode: 'manual' });
    const [n1] = await insertNodes(db, [{ orgId: 'o', buildId: b1.id, repoFullName: 'e/web', kind: 'flow', name: 'f1', commitSha: 'e1' }]);
    const [n2] = await insertNodes(db, [{ orgId: 'o', buildId: b2.id, repoFullName: 'e/web', kind: 'flow', name: 'f2', commitSha: 'e2' }]);
    await insertEmbeddings(store, [
      { nodeId: n1!.id, buildId: b1.id, embedding: E(1, 0, 0) },
      { nodeId: n2!.id, buildId: b2.id, embedding: E(0, 1, 0) },
    ]);

    await deleteBuildEmbeddings(store, b1.id);

    expect((await col(db, 'kg_node_embeddings').doc(n1!.id).get()).exists).toBe(false);
    expect((await col(db, 'kg_node_embeddings').doc(n2!.id).get()).exists).toBe(true);
    // vector point for b1 gone: a search scoped to b1 finds nothing, b2 still searchable
    expect(await store.vector.findNeighbors(E(1, 0, 0), { limit: 5, filter: { buildId: [b1.id] } })).toEqual([]);
    expect((await store.vector.findNeighbors(E(0, 1, 0), { limit: 5, filter: { buildId: [b2.id] } })).map((p) => p.id)).toEqual([n2!.id]);

    // idempotent
    await deleteBuildEmbeddings(store, b1.id);
  });
});

describe('deleteBuildNodesByKind', () => {
  it('deletes nodes of the given kinds plus edges touching them; other kinds survive', async () => {
    const b = await createBuild(db, { orgId: 'o', repoFullName: 'del/web', commitSha: 'd1', mode: 'manual' });
    const [comp, file1, file2, other] = await insertNodes(db, [
      { orgId: 'o', buildId: b.id, repoFullName: 'del/web', kind: 'component', name: 'Auth', digest: 'auth', commitSha: 'd1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'del/web', kind: 'file', name: 'src/auth/login.ts', commitSha: 'd1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'del/web', kind: 'file', name: 'src/auth/token.ts', commitSha: 'd1' },
      { orgId: 'o', buildId: b.id, repoFullName: 'del/web', kind: 'datastore', name: 'PostgreSQL', commitSha: 'd1' },
    ]);
    await insertEdges(db, [
      { orgId: 'o', buildId: b.id, srcNodeId: comp!.id, dstNodeId: file1!.id, relation: 'composes' },
      { orgId: 'o', buildId: b.id, srcNodeId: comp!.id, dstNodeId: file2!.id, relation: 'composes' },
      { orgId: 'o', buildId: b.id, srcNodeId: file1!.id, dstNodeId: file2!.id, relation: 'imports' },
    ]);
    expect(other).toBeTruthy();

    await deleteBuildNodesByKind(db, b.id, ['component']);

    const nodeSnaps = (await col(db, 'kg_nodes').where('buildId', '==', b.id).get()).map((d) => d.data());
    expect(nodeSnaps.find((n) => n?.kind === 'component')).toBeUndefined();
    expect(nodeSnaps.filter((n) => n?.kind === 'file')).toHaveLength(2);
    expect(nodeSnaps.find((n) => n?.kind === 'datastore')).toBeDefined();

    const edgeRels = (await col(db, 'kg_edges').where('buildId', '==', b.id).get()).map((d) => d.data()?.relation);
    expect(edgeRels).toEqual(['imports']);

    // no-op on missing kinds and empty list
    await deleteBuildNodesByKind(db, b.id, ['nonexistent']);
    await deleteBuildNodesByKind(db, b.id, []);
    expect((await col(db, 'kg_nodes').where('buildId', '==', b.id).get()).length).toBe(3);
  });
});
