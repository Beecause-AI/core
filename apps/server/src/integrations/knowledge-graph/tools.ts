import {
  getProjectFlows, getCurrentProjectBuildId, getNode, walkthrough, blastRadius, type Db, type KgNode,
} from '@intellilabs/core';

/** Server-side catalog wire shape. Distinct from the engine's provider.ToolDef; kind:'integration' is intentional and carried over the /int tool API. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: 'integration';
  mutates: boolean;
}

export interface KgToolCtx {
  db: Db;
  orgId: string;
  projectId: string;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

const obj = (props: Record<string, unknown>, required: string[]) =>
  ({ type: 'object', properties: props, required, additionalProperties: false });

const S = { type: 'string' } as const;

/** Static knowledge-graph tool catalog. */
export function knowledgeGraphToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.knowledge-graph.${name}`, description, parameters, kind: 'integration', mutates: false });
  return [
    d('list_flows', "List this project's business flows (id, name, digest). Start here.", obj({ repo: S }, [])),
    d('walkthrough', 'Show how a business flow is implemented: the flow plus its implementing files in order.', obj({ flow_id: S }, ['flow_id'])),
    d('blast_radius', 'Find what a change impacts: nodes reachable up/downstream from a node within N hops.',
      obj({ node_id: S, direction: { type: 'string', enum: ['upstream', 'downstream'] }, depth: { type: 'number' } }, ['node_id', 'direction'])),
    d('get_node', 'Look up one node (file or flow): name, kind, business flow, digest, path.', obj({ node_id: S }, ['node_id'])),
  ];
}

/** Dispatch a knowledge-graph.* tool: enforce project+org scope, then query. */
export async function callKnowledgeGraphTool(ctx: KgToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.knowledge-graph.', '');
  const projectBuildId = await getCurrentProjectBuildId(ctx.db, ctx.orgId, ctx.projectId);
  const inScope = (n: KgNode | null): n is KgNode => !!n && n.orgId === ctx.orgId && n.buildId === projectBuildId;

  try {
    if (bare === 'list_flows') {
      const allFlows = await getProjectFlows(ctx.db, ctx.orgId, ctx.projectId);
      let flows = allFlows;
      if (args.repo != null) {
        const repoFilter = String(args.repo);
        flows = allFlows.filter((f) => f.repoFullName === repoFilter);
      }
      return { content: JSON.stringify(flows.map((f) => ({ id: f.id, name: f.businessFlow ?? f.name, digest: f.digest, repo: f.repoFullName ?? null }))) };
    }

    if (bare === 'get_node') {
      const node = await getNode(ctx.db, String(args.node_id ?? ''));
      if (!inScope(node)) return { content: 'node not found in this project', isError: true };
      return { content: JSON.stringify({ id: node.id, name: node.name, kind: node.kind, businessFlow: node.businessFlow, digest: node.digest, path: node.codeRefPath }) };
    }

    if (bare === 'walkthrough') {
      const flow = await getNode(ctx.db, String(args.flow_id ?? ''));
      if (!inScope(flow)) return { content: 'flow not found in this project', isError: true };
      const w = await walkthrough(ctx.db, flow.id);
      if (!w) return { content: 'flow not found', isError: true };
      return { content: JSON.stringify({
        flow: { id: w.flow.id, name: w.flow.businessFlow ?? w.flow.name, digest: w.flow.digest },
        // defense-in-depth: results are in-scope by construction, but re-check in case of future cross-repo edges
        nodes: w.nodes.filter(inScope).map((n) => ({ id: n.id, name: n.name, digest: n.digest, path: n.codeRefPath })),
      }) };
    }

    if (bare === 'blast_radius') {
      const node = await getNode(ctx.db, String(args.node_id ?? ''));
      if (!inScope(node)) return { content: 'node not found in this project', isError: true };
      const direction = args.direction === 'upstream' ? 'upstream' : 'downstream';
      const depth = Math.min(4, Math.max(1, Number.isFinite(Number(args.depth)) ? Number(args.depth) : 2));
      const impacted = await blastRadius(ctx.db, node.id, direction, depth);
      // defense-in-depth: results are in-scope by construction, but re-check in case of future cross-repo edges
      return { content: JSON.stringify({ impacted: impacted.filter(inScope).map((n) => ({ id: n.id, name: n.name, kind: n.kind })) }) };
    }

    return { content: `unknown knowledge-graph tool: ${name}`, isError: true };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
