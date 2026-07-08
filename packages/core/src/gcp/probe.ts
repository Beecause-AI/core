import type { GcpClient } from './client.js';

export type GcpSignal = 'monitoring' | 'logging' | 'trace' | 'errors';
export interface SignalResult { ok: boolean; error?: string }
export type SignalReport = Record<GcpSignal, SignalResult>;

/** Tools that require each signal. `list_targets` has no signal (always offered when targets exist). */
export const SIGNAL_TOOLS: Record<GcpSignal, string[]> = {
  monitoring: ['integration.gcp.query_metrics', 'integration.gcp.list_metric_descriptors'],
  logging: ['integration.gcp.query_logs'],
  trace: ['integration.gcp.list_traces', 'integration.gcp.get_trace'],
  errors: ['integration.gcp.list_error_groups', 'integration.gcp.get_error_group'],
};

const ROLE: Record<GcpSignal, string> = {
  monitoring: 'roles/monitoring.viewer',
  logging: 'roles/logging.viewer',
  trace: 'roles/cloudtrace.user',
  errors: 'roles/errorreporting.viewer',
};

/** Probe each signal independently with a minimal read. A failure (esp. 403) ⇒ not-ok with a role hint. */
export async function probeSignals(client: GcpClient, token: string, gcpProjectId: string): Promise<SignalReport> {
  const run = async (signal: GcpSignal, fn: () => Promise<unknown>): Promise<SignalResult> => {
    try { await fn(); return { ok: true }; }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /\b403\b|permission|forbidden/i.test(msg) ? ` — grant ${ROLE[signal]}` : '';
      return { ok: false, error: `${msg}${hint}` };
    }
  };
  const [monitoring, logging, trace, errors] = await Promise.all([
    run('monitoring', () => client.listMetricDescriptors(token, gcpProjectId, {})),
    run('logging', () => client.queryLogs(token, gcpProjectId, { filter: 'severity >= DEFAULT', window: '5m', limit: 1 })),
    run('trace', () => client.listTraces(token, gcpProjectId, { window: '5m', limit: 1 })),
    run('errors', () => client.listErrorGroups(token, gcpProjectId, { window: '1h', limit: 1 })),
  ]);
  return { monitoring, logging, trace, errors };
}
