import { LogsQueryClient, MetricsQueryClient } from '@azure/monitor-query';
import { AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { MonitorClient } from '@azure/arm-monitor';
import type { TokenCredential } from '@azure/identity';

export interface AzureWindow { window?: string; start?: string; end?: string; now?: Date }

const MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Resolve a relative window ('15m','1h','7d') or explicit start/end to Date objects. */
export function resolveWindow(w: AzureWindow): { start: Date; end: Date } {
  const end = w.end ? new Date(w.end) : (w.now ?? new Date());
  if (w.start) return { start: new Date(w.start), end };
  const m = /^(\d+)([smhd])$/.exec(w.window ?? '1h');
  const span = m ? Number(m[1]) * MS[m[2] as keyof typeof MS] : MS.h;
  return { start: new Date(end.getTime() - span), end };
}

/** seconds → ISO-8601 duration for metrics granularity (e.g. 300 → 'PT5M'). */
function isoDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `PT${seconds / 3600}H`;
  if (seconds % 60 === 0) return `PT${seconds / 60}M`;
  return `PT${seconds}S`;
}

export interface MetricQuery extends AzureWindow {
  subscriptionId: string; resourceId: string; metricNames: string[];
  aggregations?: string[]; period?: number;
}

const CAP = 200;
async function collect<T>(it: AsyncIterable<T>, cap = CAP): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) { out.push(x); if (out.length >= cap) break; }
  return out;
}

export interface AzureClient {
  /** Throws if the credential cannot mint an ARM token (invalid client/secret/tenant). */
  checkCredential(cred: TokenCredential): Promise<void>;
  queryMetrics(cred: TokenCredential, p: MetricQuery): Promise<unknown>;
  listMetrics(cred: TokenCredential, p: { subscriptionId: string; resourceId: string }): Promise<unknown>;
  queryLogs(cred: TokenCredential, p: AzureWindow & { workspaceId: string; query: string }): Promise<unknown>;
  listAlerts(cred: TokenCredential, p: { subscriptionId: string; monitorCondition?: string; limit?: number }): Promise<unknown>;
}

export const realAzureClient: AzureClient = {
  async checkCredential(cred) {
    const tok = await cred.getToken('https://management.azure.com/.default');
    if (!tok) throw new Error('Azure credential returned no token (check tenant/client/secret)');
  },

  async queryMetrics(cred, p) {
    const { start, end } = resolveWindow(p);
    const client = new MetricsQueryClient(cred);
    return client.queryResource(p.resourceId, p.metricNames, {
      timespan: { startTime: start, endTime: end },
      granularity: isoDuration(p.period ?? 300),
      // AggregationType is an enum; cast via any since we accept string[] in our interface
      aggregations: (p.aggregations ?? ['Average']) as any,
    });
  },

  async listMetrics(cred, p) {
    // MonitorClient(cred, subscriptionId) from @azure/arm-monitor — not MetricsQueryClient
    const client = new MonitorClient(cred, p.subscriptionId);
    const defs = await collect(client.metricDefinitions.list(p.resourceId));
    return { metricDefinitions: defs };
  },

  async queryLogs(cred, p) {
    const { start, end } = resolveWindow(p);
    const client = new LogsQueryClient(cred);
    // QueryTimeInterval supports { startTime, endTime } — confirmed against installed types
    return client.queryWorkspace(p.workspaceId, p.query, { startTime: start, endTime: end });
  },

  async listAlerts(cred, p) {
    // ADAPTATION vs brief: AlertsManagementClient beta.1 constructor is (credential, options?)
    // — no subscriptionId arg. getAll(scope, options?) requires a subscription scope string.
    const client = new AlertsManagementClient(cred);
    const scope = `/subscriptions/${p.subscriptionId}`;
    const opts = p.monitorCondition ? ({ monitorCondition: p.monitorCondition } as any) : undefined;
    const alerts = await collect(client.alerts.getAll(scope, opts), p.limit ?? CAP);
    return { alerts };
  },
};

export const makeAzureClientForTest = (overrides: Partial<AzureClient>): AzureClient => ({ ...realAzureClient, ...overrides });
