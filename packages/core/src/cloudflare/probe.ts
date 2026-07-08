import type { CloudflareClient } from './client.js';

export type CloudflareSignal = 'analytics' | 'logs' | 'workers';
export interface SignalResult { ok: boolean; error?: string }
export type CloudflareSignalReport = Record<CloudflareSignal, SignalResult>;

export type ProbeTarget =
  | { kind: 'zone'; zoneTag: string; accountTag: string }
  | { kind: 'account'; accountTag: string };

/** Tools requiring each signal. list_targets + describe_datasets handled separately. */
export const CF_SIGNAL_TOOLS: Record<CloudflareSignal, string[]> = {
  analytics: ['integration.cloudflare.query_graphql', 'integration.cloudflare.describe_datasets', 'integration.cloudflare.http_error_summary', 'integration.cloudflare.latency_summary', 'integration.cloudflare.firewall_events'],
  logs: ['integration.cloudflare.query_graphql', 'integration.cloudflare.describe_datasets', 'integration.cloudflare.http_error_summary', 'integration.cloudflare.firewall_events'],
  workers: ['integration.cloudflare.query_worker_logs', 'integration.cloudflare.worker_errors'],
};

const PERM: Record<CloudflareSignal, string> = {
  analytics: 'Analytics: Read',
  logs: 'Logs: Read (or Account Analytics)',
  workers: 'Workers Observability: Read',
};

function probeQuery(t: ProbeTarget, dataset: 'http1h' | 'adaptive'): string {
  const ds = dataset === 'http1h' ? 'httpRequests1hGroups' : 'httpRequestsAdaptiveGroups';
  if (t.kind === 'zone') {
    return `{ viewer { zones(filter: { zoneTag: "${t.zoneTag}" }) { ${ds}(limit: 1) { count } } } }`;
  }
  return `{ viewer { accounts(filter: { accountTag: "${t.accountTag}" }) { ${ds}(limit: 1) { count } } } }`;
}

export async function probeSignals(
  client: CloudflareClient, headers: Record<string, string>, target: ProbeTarget,
): Promise<CloudflareSignalReport> {
  const run = async (signal: CloudflareSignal, fn: () => Promise<unknown>): Promise<SignalResult> => {
    try { await fn(); return { ok: true }; }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /\b403\b|permission|forbidden|unauthor/i.test(msg) ? ` — grant ${PERM[signal]}` : '';
      return { ok: false, error: `${msg}${hint}` };
    }
  };

  const [analytics, logs, workers] = await Promise.all([
    run('analytics', () => client.queryGraphql(headers, probeQuery(target, 'http1h'))),
    run('logs', () => client.queryGraphql(headers, probeQuery(target, 'adaptive'))),
    target.kind === 'account'
      ? run('workers', () => client.queryWorkerLogs(headers, target.accountTag, { window: '5m', limit: 1 }))
      : Promise.resolve<SignalResult>({ ok: false, error: 'workers not applicable to a zone target' }),
  ]);
  return { analytics, logs, workers };
}
