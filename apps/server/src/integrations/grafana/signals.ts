import { getGrafanaProjectConnection, getGrafanaConnection, type Db } from '@intellilabs/core';
import type { GrafanaSignal } from '@intellilabs/core';

export interface GrafanaContext { hasConnection: boolean; signals: Set<GrafanaSignal> }

/** Tools are offered when the project is bound; gated by the connection's verified
 *  signals (metrics/logs/traces), read from metadata.availableSignals. */
export async function projectGrafanaContext(db: Db, orgId: string, projectId: string): Promise<GrafanaContext> {
  const binding = await getGrafanaProjectConnection(db, projectId);
  if (!binding) return { hasConnection: false, signals: new Set() };
  const conn = await getGrafanaConnection(db, orgId, binding.connectionId);
  const signals = ((conn?.metadata as { availableSignals?: GrafanaSignal[] })?.availableSignals ?? []) as GrafanaSignal[];
  return { hasConnection: true, signals: new Set(signals) };
}

/** True iff the project is bound to a Grafana connection. */
export async function projectHasGrafana(db: Db, projectId: string): Promise<boolean> {
  return (await getGrafanaProjectConnection(db, projectId)) !== null;
}
