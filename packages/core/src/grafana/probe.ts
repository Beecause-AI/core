import type { GrafanaClient } from './client.js';
import type { GrafanaSignal, GrafanaDatasourceRef } from '../store/types.js';

const SIGNAL_BY_TYPE: Record<string, GrafanaSignal> = { prometheus: 'metrics', loki: 'logs', tempo: 'traces' };

/** Map a raw Grafana datasource type to our signal, or undefined if unsupported. */
export function signalForType(type: string): GrafanaSignal | undefined {
  return SIGNAL_BY_TYPE[type];
}

export interface DiscoveryResult {
  datasources: GrafanaDatasourceRef[];
  availableSignals: GrafanaSignal[];
}

/** List the instance's datasources, keep the supported types (prometheus/loki/tempo),
 *  and derive the set of available signals. */
export async function discoverDatasources(
  client: GrafanaClient, baseUrl: string, headers: Record<string, string>,
): Promise<DiscoveryResult> {
  const all = await client.listDatasources(baseUrl, headers);
  const datasources = all
    .filter((d) => signalForType(d.type))
    .map((d) => ({ uid: d.uid, name: d.name, type: d.type }));
  const signals = [...new Set(datasources.map((d) => signalForType(d.type)!))];
  return { datasources, availableSignals: signals };
}
