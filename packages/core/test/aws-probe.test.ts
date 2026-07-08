import { describe, expect, it } from 'vitest';
import { makeAwsClientForTest } from '../src/aws/client.js';
import { probeSignals } from '../src/aws/probe.js';

const creds = { accessKeyId: 'AKIA', secretAccessKey: 's' };

describe('probeSignals', () => {
  it('reports ok for signals whose probe resolves and not-ok (with IAM hint) for AccessDenied', async () => {
    const client = makeAwsClientForTest({
      listMetrics: async () => ({}),
      listLogGroups: async () => { throw new Error('User is not authorized: AccessDenied'); },
      listTraces: async () => ({}),
      listAlarms: async () => ({}),
    });
    const report = await probeSignals(client, creds, 'us-east-1');
    expect(report.metrics.ok).toBe(true);
    expect(report.logs.ok).toBe(false);
    expect(report.logs.error).toMatch(/logs:StartQuery|GetLogGroupFields|logs:/);
    expect(report.traces.ok).toBe(true);
    expect(report.alarms.ok).toBe(true);
  });
});
