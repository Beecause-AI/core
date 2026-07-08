import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner, createProject, addProjectRepo, upsertIntegration, getIntegration,
  createBuild, finishBuild, insertNodes, insertEdges,
} from '@intellilabs/core';
import { knowledgeGraphToolDefs, callKnowledgeGraphTool, type KgToolCtx } from '../src/integrations/knowledge-graph/tools.js';
import { startTestDb } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

// Primary org+project context
let ctx: KgToolCtx;

// Node IDs set up in beforeAll
let flowNodeId: string;
let fileNodeAId: string;
let fileNodeBId: string;

// Second org — for cross-org scope rejection test
let otherNodeId: string;

// Third project (same org as ctx) — for cross-project scope rejection test
let sameOrgOtherProjNodeId: string;

beforeAll(async () => {
  t = await startTestDb();
  const db = t.db;

  // ── Primary org / project / repo ─────────────────────────────────────────────
  const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme-kg', userId: 'u1' });
  const proj = await createProject(db, org.id, { name: 'Alpha', slug: 'alpha' });

  await upsertIntegration(db, {
    orgId: org.id,
    provider: 'github',
    mode: 'agent_app',
    accountLabel: 'acme',
    metadata: { installationId: 'kg-test', events: { issues: false, pullRequests: false, branches: false } },
    connectedByUserId: 'u1',
  });
  const intg = await getIntegration(db, org.id, 'github');

  await addProjectRepo(db, {
    projectId: proj.id,
    orgIntegrationId: intg!.id,
    repoFullName: 'o/r',
    defaultBranch: 'main',
    addedByUserId: 'u1',
  });

  // Seed a done project build for 'o/r'
  const build = await createBuild(db, { orgId: org.id, repoFullName: 'o/r', mode: 'manual', projectId: proj.id });
  await finishBuild(db, build.id, { status: 'done', nodesAnalyzed: 3 });

  // Flow node F
  const [flowNode] = await insertNodes(db, [{
    buildId: build.id,
    orgId: org.id,
    repoFullName: 'o/r',
    kind: 'flow',
    name: 'checkout-flow',
    businessFlow: 'Checkout',
    digest: 'Buys things.',
  }]);
  flowNodeId = flowNode!.id;

  // File node A
  const [nodeA] = await insertNodes(db, [{
    buildId: build.id,
    orgId: org.id,
    repoFullName: 'o/r',
    kind: 'file',
    name: 'src/a.ts',
    businessFlow: null,
    digest: null,
    codeRefPath: 'src/a.ts',
  }]);
  fileNodeAId = nodeA!.id;

  // File node B
  const [nodeB] = await insertNodes(db, [{
    buildId: build.id,
    orgId: org.id,
    repoFullName: 'o/r',
    kind: 'file',
    name: 'src/b.ts',
    businessFlow: null,
    digest: null,
    codeRefPath: 'src/b.ts',
  }]);
  fileNodeBId = nodeB!.id;

  // Edges: F --implements_flow--> A, A --imports--> B
  await insertEdges(db, [
    { buildId: build.id, orgId: org.id, srcNodeId: flowNodeId, dstNodeId: fileNodeAId, relation: 'implements_flow' },
    { buildId: build.id, orgId: org.id, srcNodeId: fileNodeAId, dstNodeId: fileNodeBId, relation: 'imports' },
  ]);

  ctx = { db, orgId: org.id, projectId: proj.id };

  // ── Second org — for cross-org scope rejection ────────────────────────────────
  const org2 = await createOrgWithOwner(db, { name: 'Other', slug: 'other-kg', userId: 'u2' });
  const proj2 = await createProject(db, org2.id, { name: 'Beta', slug: 'beta' });

  await upsertIntegration(db, {
    orgId: org2.id,
    provider: 'github',
    mode: 'agent_app',
    accountLabel: 'other',
    metadata: { installationId: 'kg-test-2', events: { issues: false, pullRequests: false, branches: false } },
    connectedByUserId: 'u2',
  });
  const intg2 = await getIntegration(db, org2.id, 'github');

  await addProjectRepo(db, {
    projectId: proj2.id,
    orgIntegrationId: intg2!.id,
    repoFullName: 'o2/r2',
    defaultBranch: 'main',
    addedByUserId: 'u2',
  });

  const build2 = await createBuild(db, { orgId: org2.id, repoFullName: 'o2/r2', mode: 'manual', projectId: proj2.id });
  await finishBuild(db, build2.id, { status: 'done', nodesAnalyzed: 1 });

  const [nodeX] = await insertNodes(db, [{
    buildId: build2.id,
    orgId: org2.id,
    repoFullName: 'o2/r2',
    kind: 'file',
    name: 'src/x.ts',
    businessFlow: null,
    digest: null,
    codeRefPath: 'src/x.ts',
  }]);
  otherNodeId = nodeX!.id;

  // ── Third project (same org as ctx) — for cross-project same-org scope rejection ──
  // Reuse the existing org integration (unique constraint: org+provider)
  const proj3 = await createProject(db, org.id, { name: 'Gamma', slug: 'gamma' });

  await addProjectRepo(db, {
    projectId: proj3.id,
    orgIntegrationId: intg!.id,
    repoFullName: 'o/r3',
    defaultBranch: 'main',
    addedByUserId: 'u1',
  });

  const build3 = await createBuild(db, { orgId: org.id, repoFullName: 'o/r3', mode: 'manual', projectId: proj3.id });
  await finishBuild(db, build3.id, { status: 'done', nodesAnalyzed: 1 });

  const [nodeY] = await insertNodes(db, [{
    buildId: build3.id,
    orgId: org.id,
    repoFullName: 'o/r3',
    kind: 'file',
    name: 'src/y.ts',
    businessFlow: null,
    digest: null,
    codeRefPath: 'src/y.ts',
  }]);
  sameOrgOtherProjNodeId = nodeY!.id;
});

afterAll(async () => { await t.stop(); });

describe('knowledgeGraphToolDefs()', () => {
  it('returns 4 defs, all mutates:false, with expected names', () => {
    const defs = knowledgeGraphToolDefs();
    expect(defs).toHaveLength(4);
    expect(defs.every((d) => d.mutates === false)).toBe(true);
    expect(defs.every((d) => d.kind === 'integration')).toBe(true);
    const names = defs.map((d) => d.name);
    expect(names).toContain('integration.knowledge-graph.list_flows');
    expect(names).toContain('integration.knowledge-graph.walkthrough');
    expect(names).toContain('integration.knowledge-graph.blast_radius');
    expect(names).toContain('integration.knowledge-graph.get_node');
  });
});

describe('list_flows', () => {
  it('returns the flow node for the project (no args)', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.list_flows', {});
    expect(result.isError).toBeFalsy();
    const flows = JSON.parse(result.content) as Array<{ id: string; name: string; digest: string | null; repo: string }>;
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ id: flowNodeId, name: 'Checkout', digest: 'Buys things.', repo: 'o/r' });
  });

  it('filters by repo when repo arg is provided', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.list_flows', { repo: 'o/r' });
    expect(result.isError).toBeFalsy();
    const flows = JSON.parse(result.content) as Array<{ id: string }>;
    expect(flows).toHaveLength(1);
    expect(flows[0]!.id).toBe(flowNodeId);
  });

  it('returns empty array (not isError) for a repo not matching any flows', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.list_flows', { repo: 'o/other' });
    expect(result.isError).toBeFalsy();
    const flows = JSON.parse(result.content) as Array<unknown>;
    expect(flows).toHaveLength(0);
  });
});

describe('walkthrough', () => {
  it('returns the flow and its implementing nodes', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.walkthrough', { flow_id: flowNodeId });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content) as { flow: { name: string }; nodes: Array<{ id: string; name: string }> };
    expect(body.flow.name).toBe('Checkout');
    expect(body.nodes.some((n) => n.name === 'src/a.ts')).toBe(true);
    // defense-in-depth: all returned nodes must belong to the project's build (ids match o/r build nodes)
    const inScopeIds = new Set([flowNodeId, fileNodeAId, fileNodeBId]);
    expect(body.nodes.every((n) => inScopeIds.has(n.id))).toBe(true);
  });

  it('returns isError for an out-of-scope flow_id (other org node)', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.walkthrough', { flow_id: otherNodeId });
    expect(result.isError).toBe(true);
  });

  it('SCOPE: rejects a node from a different project in the same org', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.walkthrough', { flow_id: sameOrgOtherProjNodeId });
    expect(result.isError).toBe(true);
  });
});

describe('blast_radius', () => {
  it('finds downstream impacted nodes', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.blast_radius', { node_id: fileNodeAId, direction: 'downstream', depth: 2 });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content) as { impacted: Array<{ id: string; name: string }> };
    expect(body.impacted.some((n) => n.name === 'src/b.ts')).toBe(true);
    // defense-in-depth: all returned nodes must belong to the project's build (ids match o/r build nodes)
    const inScopeIds = new Set([flowNodeId, fileNodeAId, fileNodeBId]);
    expect(body.impacted.every((n) => inScopeIds.has(n.id))).toBe(true);
  });

  it('returns isError for a node not in this project (cross-org)', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.blast_radius', { node_id: otherNodeId, direction: 'downstream', depth: 1 });
    expect(result.isError).toBe(true);
  });

  it('SCOPE: rejects a node from a different project in the same org', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.blast_radius', { node_id: sameOrgOtherProjNodeId, direction: 'downstream', depth: 1 });
    expect(result.isError).toBe(true);
  });
});

describe('get_node', () => {
  it('returns node details for an in-scope node', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.get_node', { node_id: fileNodeAId });
    expect(result.isError).toBeFalsy();
    const node = JSON.parse(result.content) as { id: string; name: string; kind: string };
    expect(node).toMatchObject({ id: fileNodeAId, name: 'src/a.ts', kind: 'file' });
  });

  it('SCOPE: rejects a node from a different org via the primary ctx', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.get_node', { node_id: otherNodeId });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found in this project');
  });

  it('SCOPE: rejects a node from a different project in the same org', async () => {
    const result = await callKnowledgeGraphTool(ctx, 'integration.knowledge-graph.get_node', { node_id: sameOrgOtherProjNodeId });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found in this project');
  });
});
