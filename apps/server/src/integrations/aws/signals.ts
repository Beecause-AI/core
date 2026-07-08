import { listAwsTargets, listAwsConnectionsForProject, type Db, type AwsSignal } from '@intellilabs/core';

export interface AwsContext { hasScope: boolean; signals: Set<AwsSignal> }

/** Tools are offered when the project has ≥1 (account,region) target; the signal set is the
 *  UNION of availableSignals across the connections those targets reference. */
export async function projectAwsContext(db: Db, orgId: string, projectId: string): Promise<AwsContext> {
  const targets = await listAwsTargets(db, projectId);
  if (targets.length === 0) return { hasScope: false, signals: new Set() };
  const conns = await listAwsConnectionsForProject(db, orgId, projectId);
  const used = new Set(targets.map((t) => t.connectionId));
  const signals = new Set<AwsSignal>();
  for (const c of conns) {
    if (!used.has(c.id)) continue;
    for (const s of ((c.metadata as { availableSignals?: AwsSignal[] })?.availableSignals ?? [])) signals.add(s);
  }
  return { hasScope: true, signals };
}

/** True iff the project has at least one AWS target. */
export async function projectHasAws(db: Db, projectId: string): Promise<boolean> {
  return (await listAwsTargets(db, projectId)).length > 0;
}
