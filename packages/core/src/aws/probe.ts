import type { AwsClient } from './client.js';
import type { ResolvedAwsCreds } from './auth.js';

export type AwsSignal = 'metrics' | 'logs' | 'traces' | 'alarms';
export interface SignalResult { ok: boolean; error?: string }
export type AwsSignalReport = Record<AwsSignal, SignalResult>;

/** Tools that require each signal. list_scope/describe_datasets have no signal. */
export const SIGNAL_TOOLS: Record<AwsSignal, string[]> = {
  metrics: ['integration.aws.query_metrics', 'integration.aws.list_metrics', 'integration.aws.error_rate_summary', 'integration.aws.latency_summary'],
  logs: ['integration.aws.query_logs', 'integration.aws.list_log_groups', 'integration.aws.log_error_summary'],
  traces: ['integration.aws.list_traces', 'integration.aws.get_trace'],
  alarms: ['integration.aws.list_alarms'],
};

const HINT: Record<AwsSignal, string> = {
  metrics: ' — grant cloudwatch:GetMetricData / cloudwatch:ListMetrics',
  logs: ' — grant logs:StartQuery / logs:GetQueryResults / logs:DescribeLogGroups',
  traces: ' — grant xray:GetTraceSummaries / xray:BatchGetTraces',
  alarms: ' — grant cloudwatch:DescribeAlarms',
};

/** Probe each signal independently with a minimal read. AccessDenied/403 ⇒ not-ok with an IAM hint. */
export async function probeSignals(client: AwsClient, creds: ResolvedAwsCreds, region: string): Promise<AwsSignalReport> {
  const run = async (signal: AwsSignal, fn: () => Promise<unknown>): Promise<SignalResult> => {
    try { await fn(); return { ok: true }; }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = /\b403\b|accessdenied|not authorized|forbidden|unauthorizedoperation/i.test(msg);
      return { ok: false, error: `${msg}${denied ? HINT[signal] : ''}` };
    }
  };
  const [metrics, logs, traces, alarms] = await Promise.all([
    run('metrics', () => client.listMetrics(creds, region, {})),
    run('logs', () => client.listLogGroups(creds, region, { limit: 1 })),
    run('traces', () => client.listTraces(creds, region, { window: '5m' })),
    run('alarms', () => client.listAlarms(creds, region, { limit: 1 })),
  ]);
  return { metrics, logs, traces, alarms };
}
