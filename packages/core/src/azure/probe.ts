import type { AzureClient } from './client.js';
import type { TokenCredential } from '@azure/identity';

export type AzureSignal = 'metrics' | 'logs' | 'traces' | 'alerts';
export interface SignalResult { ok: boolean; error?: string }
export type AzureSignalReport = Record<AzureSignal, SignalResult>;

/** Tools that require each signal. list_scope/describe_datasets have no signal. */
export const SIGNAL_TOOLS: Record<AzureSignal, string[]> = {
  metrics: ['integration.azure.query_metrics', 'integration.azure.list_metrics'],
  logs: ['integration.azure.query_logs', 'integration.azure.list_tables', 'integration.azure.log_error_summary'],
  traces: ['integration.azure.list_traces', 'integration.azure.get_trace', 'integration.azure.error_rate_summary', 'integration.azure.latency_summary'],
  alerts: ['integration.azure.list_alerts'],
};

const HINT: Record<AzureSignal, string> = {
  metrics: ' — grant the Monitoring Reader role on the subscription',
  logs: ' — grant the Log Analytics Reader role on the workspace',
  traces: ' — grant the Log Analytics Reader role on the Application Insights workspace (Monitoring Reader)',
  alerts: ' — grant the Monitoring Reader role on the subscription',
};

export interface ProbeScope { subscriptionId: string; workspaceId: string | null }

/** Probe each signal independently with a minimal read. AuthorizationFailed/403 ⇒ not-ok + RBAC hint.
 *  metrics is credential-level (per-resource RBAC surfaces at query time); logs/traces need a workspace. */
export async function probeSignals(client: AzureClient, cred: TokenCredential, scope: ProbeScope): Promise<AzureSignalReport> {
  const run = async (signal: AzureSignal, fn: () => Promise<unknown>): Promise<SignalResult> => {
    try { await fn(); return { ok: true }; }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = /\b403\b|authorizationfailed|forbidden|insufficient privileges|does not have authorization/i.test(msg);
      return { ok: false, error: `${msg}${denied ? HINT[signal] : ''}` };
    }
  };
  const noWorkspace = async (): Promise<SignalResult> => ({ ok: false, error: 'no Log Analytics workspace in scope — add one to a target to enable logs/traces' });

  const [metrics, logs, traces, alerts] = await Promise.all([
    run('metrics', () => client.checkCredential(cred)),
    scope.workspaceId ? run('logs', () => client.queryLogs(cred, { workspaceId: scope.workspaceId!, query: 'print 1', window: '5m' })) : noWorkspace(),
    scope.workspaceId ? run('traces', () => client.queryLogs(cred, { workspaceId: scope.workspaceId!, query: 'AppRequests | take 1', window: '1h' })) : noWorkspace(),
    run('alerts', () => client.listAlerts(cred, { subscriptionId: scope.subscriptionId, limit: 1 })),
  ]);
  return { metrics, logs, traces, alerts };
}
