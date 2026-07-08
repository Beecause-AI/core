import type { DynatraceClient } from './client.js';
import type { DynatraceCreds } from './auth.js';

export type DynatraceSignal = 'metrics' | 'logs' | 'problems';
export interface SignalResult { ok: boolean; error?: string }
export type DynatraceSignalReport = Record<DynatraceSignal, SignalResult>;

const SIGNAL_SCOPES: Record<DynatraceSignal, string> = {
  metrics: 'metrics.read',
  logs: 'logs.read',
  problems: 'problems.read',
};

export const SIGNAL_TOOLS: Record<DynatraceSignal, string[]> = {
  metrics: ['integration.dynatrace.query_metrics', 'integration.dynatrace.list_metrics', 'integration.dynatrace.error_rate_summary', 'integration.dynatrace.latency_summary'],
  logs: ['integration.dynatrace.query_logs', 'integration.dynatrace.log_error_summary'],
  problems: ['integration.dynatrace.list_problems', 'integration.dynatrace.get_problem'],
};

async function probeSignal(client: DynatraceClient, creds: DynatraceCreds, signal: DynatraceSignal): Promise<SignalResult> {
  try {
    if (signal === 'metrics') await client.listMetrics(creds, { pageSize: 1 });
    else if (signal === 'logs') await client.searchLogs(creds, { query: '', window: '1h', limit: 1 });
    else await client.listProblems(creds, { window: '1h', pageSize: 1 });
    return { ok: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403 || status === 401) {
      return { ok: false, error: `The API token is missing the ${SIGNAL_SCOPES[signal]} scope.` };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'probe failed' };
  }
}

export async function probeSignals(client: DynatraceClient, creds: DynatraceCreds): Promise<DynatraceSignalReport> {
  try { await client.validate(creds); }
  catch (err) {
    const msg = err instanceof Error ? err.message : 'token validation failed';
    return { metrics: { ok: false, error: msg }, logs: { ok: false, error: msg }, problems: { ok: false, error: msg } };
  }
  const signals: DynatraceSignal[] = ['metrics', 'logs', 'problems'];
  const results = await Promise.all(signals.map((s) => probeSignal(client, creds, s)));
  return Object.fromEntries(signals.map((s, i) => [s, results[i]!])) as DynatraceSignalReport;
}
