import { listDatadogTargets, listDatadogConnectionsForProject, type Db, type DatadogSignal } from '@intellilabs/core';

export interface DatadogContext { hasScope: boolean; signals: Set<DatadogSignal> }

/** Tools are offered when the project has ≥1 target; the signal set is the UNION of availableSignals
 *  across the connections those targets reference. All signals are valid for any env/service target
 *  (no workspace-style subtraction needed for Datadog). */
export async function projectDatadogContext(db: Db, orgId: string, projectId: string): Promise<DatadogContext> {
  const targets = await listDatadogTargets(db, projectId);
  if (targets.length === 0) return { hasScope: false, signals: new Set() };
  const conns = await listDatadogConnectionsForProject(db, orgId, projectId);
  const used = new Set(targets.map((t) => t.connectionId));
  const signals = new Set<DatadogSignal>();
  for (const c of conns) {
    if (!used.has(c.id) || !c.enabled) continue;
    for (const s of ((c.metadata as { availableSignals?: DatadogSignal[] })?.availableSignals ?? [])) signals.add(s);
  }
  return { hasScope: true, signals };
}

/** True iff the project has at least one Datadog target. */
export async function projectHasDatadog(db: Db, projectId: string): Promise<boolean> {
  return (await listDatadogTargets(db, projectId)).length > 0;
}
