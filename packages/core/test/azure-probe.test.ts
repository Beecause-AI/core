import { describe, expect, it } from 'vitest';
import { makeAzureClientForTest } from '../src/azure/client.js';
import { probeSignals } from '../src/azure/probe.js';

const cred = { getToken: async () => ({ token: 't', expiresOnTimestamp: 0 }) } as any;

describe('probeSignals', () => {
  it('marks signals ok/not-ok and adds an RBAC hint on AuthorizationFailed', async () => {
    const client = makeAzureClientForTest({
      checkCredential: async () => {},
      queryLogs: async (_c, p: any) => { if (p.query.includes('AppRequests')) throw new Error('AuthorizationFailed: insufficient privileges'); return {}; },
      listAlerts: async () => ({}),
    });
    const report = await probeSignals(client, cred, { subscriptionId: 'sub-1', workspaceId: 'ws-1' });
    expect(report.metrics.ok).toBe(true);
    expect(report.logs.ok).toBe(true);
    expect(report.traces.ok).toBe(false);
    expect(report.traces.error).toMatch(/Monitoring Reader|Log Analytics Reader/);
    expect(report.alerts.ok).toBe(true);
  });

  it('marks logs/traces not-ok with a clear message when no workspace is in scope', async () => {
    const client = makeAzureClientForTest({ checkCredential: async () => {}, listAlerts: async () => ({}) });
    const report = await probeSignals(client, cred, { subscriptionId: 'sub-1', workspaceId: null });
    expect(report.logs.ok).toBe(false);
    expect(report.logs.error).toMatch(/workspace/i);
    expect(report.traces.ok).toBe(false);
    expect(report.metrics.ok).toBe(true);
  });
});
