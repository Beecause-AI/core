import type { DatadogClient } from './client.js';
import type { DatadogCreds } from './auth.js';

export type DatadogSignal = 'metrics' | 'logs' | 'traces' | 'alerts';
export interface SignalResult { ok: boolean; error?: string }
export type DatadogSignalReport = Record<DatadogSignal, SignalResult>;

const SIGNAL_SCOPES: Record<DatadogSignal, string> = {
  metrics: 'metrics_read',
  logs: 'logs_read_data',
  traces: 'apm_read',
  alerts: 'monitors_read',
};

export const SIGNAL_TOOLS: Record<DatadogSignal, string[]> = {
  metrics: ['integration.datadog.query_metrics', 'integration.datadog.list_metrics'],
  logs: ['integration.datadog.query_logs', 'integration.datadog.log_error_summary'],
  traces: ['integration.datadog.list_traces', 'integration.datadog.get_trace', 'integration.datadog.error_rate_summary', 'integration.datadog.latency_summary'],
  alerts: ['integration.datadog.list_monitors'],
};

async function probeSignal(
  client: DatadogClient,
  creds: DatadogCreds,
  signal: DatadogSignal,
): Promise<SignalResult> {
  try {
    switch (signal) {
      case 'metrics': await client.listMetrics(creds, { window: '1h' }); break;
      case 'logs': await client.searchLogs(creds, { window: '1h', query: '*', limit: 1 }); break;
      case 'traces': await client.searchSpans(creds, { window: '1h', query: '*', limit: 1 }); break;
      case 'alerts': await client.listMonitors(creds, {}); break;
    }
    return { ok: true };
  } catch (err: any) {
    if (err?.status === 403) {
      return { ok: false, error: `${signal}: the Application key needs the ${SIGNAL_SCOPES[signal]} read scope` };
    }
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function probeSignals(client: DatadogClient, creds: DatadogCreds): Promise<DatadogSignalReport> {
  // First validate credentials
  try {
    await client.validate(creds);
  } catch (err: any) {
    const error = err?.message ?? String(err);
    return {
      metrics: { ok: false, error },
      logs: { ok: false, error },
      traces: { ok: false, error },
      alerts: { ok: false, error },
    };
  }
  const signals: DatadogSignal[] = ['metrics', 'logs', 'traces', 'alerts'];
  const results = await Promise.all(signals.map((s) => probeSignal(client, creds, s)));
  return Object.fromEntries(signals.map((s, i) => [s, results[i]!])) as DatadogSignalReport;
}
