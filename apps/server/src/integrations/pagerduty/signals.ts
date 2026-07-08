import { listPagerDutyTargets, listPagerDutyConnectionsForProject, type Db, type PagerDutySignal } from '@intellilabs/core';

export interface PagerDutyContext { hasScope: boolean; signals: Set<PagerDutySignal> }

/** Tools are offered when the project has ≥1 target; the signal set is the UNION of availableSignals
 *  across the connections those targets reference. All signals are valid for any scope target
 *  (no workspace-style subtraction needed for PagerDuty). */
export async function projectPagerDutyContext(db: Db, orgId: string, projectId: string): Promise<PagerDutyContext> {
  const targets = await listPagerDutyTargets(db, projectId);
  if (targets.length === 0) return { hasScope: false, signals: new Set() };
  const conns = await listPagerDutyConnectionsForProject(db, orgId, projectId);
  const used = new Set(targets.map((t) => t.connectionId));
  const signals = new Set<PagerDutySignal>();
  for (const c of conns) {
    if (!used.has(c.id) || !c.enabled) continue;
    for (const s of ((c.metadata as { availableSignals?: PagerDutySignal[] })?.availableSignals ?? [])) signals.add(s);
  }
  return { hasScope: true, signals };
}

/** True iff the project has at least one PagerDuty target. */
export async function projectHasPagerDuty(db: Db, projectId: string): Promise<boolean> {
  return (await listPagerDutyTargets(db, projectId)).length > 0;
}
