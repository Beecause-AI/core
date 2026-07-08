import { listDynatraceTargets, listDynatraceConnectionsForProject, type Db, type DynatraceSignal } from '@intellilabs/core';

export interface DynatraceContext { hasScope: boolean; signals: Set<DynatraceSignal> }

/** Tools are offered when the project has ≥1 target; the signal set is the UNION of availableSignals
 *  across the connections those targets reference. */
export async function projectDynatraceContext(db: Db, orgId: string, projectId: string): Promise<DynatraceContext> {
  const targets = await listDynatraceTargets(db, projectId);
  if (targets.length === 0) return { hasScope: false, signals: new Set() };
  const conns = await listDynatraceConnectionsForProject(db, orgId, projectId);
  const used = new Set(targets.map((t) => t.connectionId));
  const signals = new Set<DynatraceSignal>();
  for (const c of conns) {
    if (!used.has(c.id) || !c.enabled) continue;
    for (const s of ((c.metadata as { availableSignals?: DynatraceSignal[] })?.availableSignals ?? [])) signals.add(s);
  }
  return { hasScope: true, signals };
}

/** True iff the project has at least one Dynatrace target. */
export async function projectHasDynatrace(db: Db, projectId: string): Promise<boolean> {
  return (await listDynatraceTargets(db, projectId)).length > 0;
}
