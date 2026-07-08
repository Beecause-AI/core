import { getGcpProjectConnection, getGcpConnection, type Db } from '@intellilabs/core';
import type { GcpSignal } from '@intellilabs/core';

export interface GcpContext { hasConnection: boolean; signals: Set<GcpSignal> }

/** Tools are offered when the project is bound to a connection; gated by the
 *  connection's verified signals (monitoring/logging/trace). */
export async function projectGcpContext(db: Db, orgId: string, projectId: string): Promise<GcpContext> {
  const binding = await getGcpProjectConnection(db, projectId);
  if (!binding) return { hasConnection: false, signals: new Set() };
  const conn = await getGcpConnection(db, orgId, binding.connectionId);
  const signals = ((conn?.metadata as { availableSignals?: GcpSignal[] })?.availableSignals ?? []) as GcpSignal[];
  return { hasConnection: true, signals: new Set(signals) };
}

/** True iff the project is bound to a GCP connection. */
export async function projectHasGcp(db: Db, orgId: string, projectId: string): Promise<boolean> {
  return (await getGcpProjectConnection(db, projectId)) !== null;
}
