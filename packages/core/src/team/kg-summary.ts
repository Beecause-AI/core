import type { Db } from '../db/client.js';
import type { KgNode } from '../db/schema.js';
import { getProjectFlows, getChildren } from '../repos/knowledge-graph.js';

/** Pure renderer: flows + the components implementing each, as compact text. */
export function renderKgSummary(flows: KgNode[], childrenByFlow: Record<string, KgNode[]>): string {
  if (flows.length === 0) return '(no business flows in the knowledge graph)';
  return flows.map((f) => {
    const kids = childrenByFlow[f.id] ?? [];
    const impl = kids.map((k) => `- ${k.name}${k.digest ? `: ${k.digest}` : ''}`).join('\n');
    return [`Flow: ${f.name}`, f.businessFlow ? `Purpose: ${f.businessFlow}` : null, impl || '(no components mapped)']
      .filter(Boolean).join('\n');
  }).join('\n\n');
}

/** DB-backed: assemble the KG summary text for a project's current build. */
export async function buildKgSummary(db: Db, orgId: string, projectId: string): Promise<string> {
  const flows = await getProjectFlows(db, orgId, projectId);
  const childrenByFlow: Record<string, KgNode[]> = {};
  for (const f of flows) childrenByFlow[f.id] = await getChildren(db, f.id, ['implements_flow']);
  return renderKgSummary(flows, childrenByFlow);
}
