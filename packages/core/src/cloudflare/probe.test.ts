import { describe, it, expect } from 'vitest';
import { probeSignals, CF_SIGNAL_TOOLS } from './probe.js';
import type { CloudflareClient } from './client.js';

const ok = async () => ({});
const fail = async () => { throw new Error('403 forbidden'); };

function client(over: Partial<CloudflareClient>): CloudflareClient {
  return {
    queryGraphql: ok, queryWorkerLogs: ok, verifyToken: ok, listAccounts: ok, listZones: ok, ...over,
  } as CloudflareClient;
}
const H = { Authorization: 'Bearer t' };

describe('probeSignals', () => {
  it('zone target: probes analytics + logs only, workers omitted', async () => {
    const r = await probeSignals(client({}), H, { kind: 'zone', zoneTag: 'z1', accountTag: 'a1' });
    expect(r.analytics.ok).toBe(true);
    expect(r.logs.ok).toBe(true);
    expect(r.workers.ok).toBe(false);
    expect(r.workers.error).toMatch(/not applicable/i);
  });

  it('account target: probes all three', async () => {
    const r = await probeSignals(client({}), H, { kind: 'account', accountTag: 'a1' });
    expect(r.analytics.ok).toBe(true);
    expect(r.workers.ok).toBe(true);
  });

  it('reports a permission hint on 403', async () => {
    const r = await probeSignals(client({ queryGraphql: fail }), H, { kind: 'account', accountTag: 'a1' });
    expect(r.analytics.ok).toBe(false);
    expect(r.analytics.error).toMatch(/Analytics/);
  });

  it('CF_SIGNAL_TOOLS maps signals to tool names', () => {
    expect(CF_SIGNAL_TOOLS.workers).toContain('integration.cloudflare.query_worker_logs');
    expect(CF_SIGNAL_TOOLS.analytics).toContain('integration.cloudflare.query_graphql');
  });
});
