import { describe, expect, it } from 'vitest';
import { makeDatadogClientForTest } from '../src/datadog/client.js';
import { probeSignals } from '../src/datadog/probe.js';
import type { DatadogCreds } from '../src/datadog/auth.js';

const creds: DatadogCreds = { mode: 'api_keys', apiKey: 'test-api-key', appKey: 'test-app-key', site: 'us1' };

describe('probeSignals', () => {
  it('returns all ok when all client calls succeed', async () => {
    const client = makeDatadogClientForTest();
    const report = await probeSignals(client, creds);
    expect(report.metrics.ok).toBe(true);
    expect(report.logs.ok).toBe(true);
    expect(report.traces.ok).toBe(true);
    expect(report.alerts.ok).toBe(true);
  });

  it('marks traces not-ok with apm_read hint on 403, others remain ok', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    const client = makeDatadogClientForTest({
      searchSpans: async () => { throw err; },
    });
    const report = await probeSignals(client, creds);
    expect(report.traces.ok).toBe(false);
    expect(report.traces.error).toMatch(/apm_read/);
    expect(report.metrics.ok).toBe(true);
    expect(report.logs.ok).toBe(true);
    expect(report.alerts.ok).toBe(true);
  });

  it('marks all signals not-ok when validate throws', async () => {
    const client = makeDatadogClientForTest({
      validate: async () => { throw new Error('Invalid API key'); },
    });
    const report = await probeSignals(client, creds);
    expect(report.metrics.ok).toBe(false);
    expect(report.logs.ok).toBe(false);
    expect(report.traces.ok).toBe(false);
    expect(report.alerts.ok).toBe(false);
  });
});
