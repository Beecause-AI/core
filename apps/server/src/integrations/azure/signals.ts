import { listAzureTargets, listAzureConnectionsForProject, type Db, type AzureSignal } from '@intellilabs/core';

export interface AzureContext { hasScope: boolean; signals: Set<AzureSignal> }

/** Tools are offered when the project has ≥1 target; the signal set is the UNION of availableSignals
 *  across the connections those targets reference. Logs/traces additionally require ≥1 target with a workspace. */
export async function projectAzureContext(db: Db, orgId: string, projectId: string): Promise<AzureContext> {
  const targets = await listAzureTargets(db, projectId);
  if (targets.length === 0) return { hasScope: false, signals: new Set() };
  const conns = await listAzureConnectionsForProject(db, orgId, projectId);
  const used = new Set(targets.map((t) => t.connectionId));
  const hasWorkspace = targets.some((t) => t.logAnalyticsWorkspaceId);
  const signals = new Set<AzureSignal>();
  for (const c of conns) {
    if (!used.has(c.id)) continue;
    for (const s of ((c.metadata as { availableSignals?: AzureSignal[] })?.availableSignals ?? [])) signals.add(s);
  }
  // Logs/traces are unusable without a workspace in scope, regardless of what verify probed.
  if (!hasWorkspace) { signals.delete('logs'); signals.delete('traces'); }
  return { hasScope: true, signals };
}

/** True iff the project has at least one Azure target. */
export async function projectHasAzure(db: Db, projectId: string): Promise<boolean> {
  return (await listAzureTargets(db, projectId)).length > 0;
}
