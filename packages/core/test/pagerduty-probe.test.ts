import { describe, it, expect } from 'vitest';
import { probeSignals } from '../src/pagerduty/probe.js';
import { makePagerDutyClientForTest } from '../src/pagerduty/client.js';

const creds = { mode: 'api_keys' as const, region: 'us' as const, apiToken: 't' };

describe('probeSignals', () => {
  it('reports alerts ok when validate + listIncidents succeed', async () => {
    const report = await probeSignals(makePagerDutyClientForTest(), creds);
    expect(report.alerts.ok).toBe(true);
  });

  it('reports alerts not-ok with a 403 hint when incidents read is denied', async () => {
    const client = makePagerDutyClientForTest({
      listIncidents: async () => { const e: any = new Error('forbidden'); e.status = 403; throw e; },
    });
    const report = await probeSignals(client, creds);
    expect(report.alerts.ok).toBe(false);
    expect(report.alerts.error).toMatch(/read access to incidents/);
  });

  it('surfaces an invalid-token error from validate', async () => {
    const client = makePagerDutyClientForTest({
      validate: async () => { const e: any = new Error('bad'); e.status = 401; throw e; },
    });
    const report = await probeSignals(client, creds);
    expect(report.alerts.ok).toBe(false);
    expect(report.alerts.error).toMatch(/invalid API token/);
  });
});
