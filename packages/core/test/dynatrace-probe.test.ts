import { describe, it, expect } from 'vitest';
import { probeDynatraceSignals, makeDynatraceClientForTest, DYNATRACE_SIGNAL_TOOLS } from '../src/index.js';

const creds = { mode: 'api_token' as const, environmentUrl: 'https://x', apiToken: 't' };

describe('dynatrace probe', () => {
  it('maps signals to their tools', () => {
    expect(DYNATRACE_SIGNAL_TOOLS.metrics).toContain('integration.dynatrace.query_metrics');
    expect(DYNATRACE_SIGNAL_TOOLS.metrics).toContain('integration.dynatrace.error_rate_summary');
    expect(DYNATRACE_SIGNAL_TOOLS.logs).toContain('integration.dynatrace.query_logs');
    expect(DYNATRACE_SIGNAL_TOOLS.problems).toContain('integration.dynatrace.list_problems');
  });
  it('reports all signals ok when the client succeeds', async () => {
    const report = await probeDynatraceSignals(makeDynatraceClientForTest(), creds);
    expect(report.metrics.ok && report.logs.ok && report.problems.ok).toBe(true);
  });
  it('maps a 403 on logs to a scope hint', async () => {
    const client = makeDynatraceClientForTest({
      async searchLogs() { const e = new Error('forbidden') as Error & { status?: number }; e.status = 403; throw e; },
    });
    const report = await probeDynatraceSignals(client, creds);
    expect(report.logs.ok).toBe(false);
    expect(report.logs.error).toContain('logs.read');
    expect(report.metrics.ok).toBe(true);
  });
});
