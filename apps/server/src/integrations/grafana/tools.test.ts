import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real signalForType mapping (prometheus→metrics, loki→logs, tempo→traces).
// We provide this as the REAL implementation so datasource resolution works.
function realSignalForType(type: string): 'metrics' | 'logs' | 'traces' | undefined {
  const map: Record<string, 'metrics' | 'logs' | 'traces'> = {
    prometheus: 'metrics',
    loki: 'logs',
    tempo: 'traces',
  };
  return map[type];
}

const {
  getGrafanaProjectConnection,
  getGrafanaConnection,
  listGrafanaTargets,
} = vi.hoisted(() => ({
  getGrafanaProjectConnection: vi.fn(async () => ({ connectionId: 'c1', orgId: 'o1' }) as any),
  getGrafanaConnection: vi.fn(async () => ({
    id: 'c1',
    mode: 'grafana',
    baseUrl: 'https://grafana.io',
    secretCiphertext: 'ct',
    metadata: { availableSignals: ['metrics', 'logs', 'traces'], datasources: [] },
  }) as any),
  listGrafanaTargets: vi.fn(async () => [] as any[]),
}));

vi.mock('@intellilabs/core', () => ({
  getGrafanaProjectConnection,
  getGrafanaConnection,
  listGrafanaTargets,
  grafanaCredsForConnection: vi.fn(() => ({ mode: 'grafana', token: 'tok' })),
  grafanaAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer tok' })),
  grafanaSignalForType: realSignalForType,
  grafanaErrorRatePromQL: vi.fn(() => 'sum(rate(http_requests_total{status=~"5.."}[5m]))'),
  grafanaLatencyPromQL: vi.fn((q: number) => `histogram_quantile(${q}, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`),
  grafanaLogErrorLogQL: vi.fn(() => '{job=~".+"} |= "error"'),
  realGrafanaClient: {
    queryMetrics: vi.fn(async () => ({ sentinel: 'metrics' })),
    queryLogs: vi.fn(async () => ({ sentinel: 'logs' })),
    searchTraces: vi.fn(async () => ({ sentinel: 'traces' })),
    getTrace: vi.fn(async () => ({ sentinel: 'trace' })),
  },
}));

import { grafanaToolDefs, filterGrafanaToolDefs, callGrafanaTool, SIGNAL_OF } from './tools.js';

const ctx = () => ({ db: {} as any, orgId: 'o1', projectId: 'p1', config: { SECRETS_KEY: 'k' } });

const fakeClient = {
  getOrg: vi.fn(async () => ({ name: 'Acme' })),
  listDatasources: vi.fn(async () => []),
  queryMetrics: vi.fn(async () => ({ ran: 'metrics' })),
  queryLogs: vi.fn(async () => ({ ran: 'logs' })),
  searchTraces: vi.fn(async () => ({ ran: 'traces' })),
  getTrace: vi.fn(async () => ({ ran: 'trace' })),
};

const withDatasources = (datasources: { uid: string; name: string; type: string }[]) => {
  getGrafanaConnection.mockResolvedValue({
    id: 'c1',
    mode: 'grafana',
    baseUrl: 'https://grafana.io',
    secretCiphertext: 'ct',
    metadata: { availableSignals: ['metrics', 'logs', 'traces'], datasources },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to sensible defaults
  getGrafanaProjectConnection.mockResolvedValue({ connectionId: 'c1', orgId: 'o1' });
  getGrafanaConnection.mockResolvedValue({
    id: 'c1',
    mode: 'grafana',
    baseUrl: 'https://grafana.io',
    secretCiphertext: 'ct',
    metadata: { availableSignals: ['metrics', 'logs', 'traces'], datasources: [] },
  });
  listGrafanaTargets.mockResolvedValue([]);
  fakeClient.getOrg.mockResolvedValue({ name: 'Acme' });
  fakeClient.listDatasources.mockResolvedValue([]);
  fakeClient.queryMetrics.mockResolvedValue({ ran: 'metrics' });
  fakeClient.queryLogs.mockResolvedValue({ ran: 'logs' });
  fakeClient.searchTraces.mockResolvedValue({ ran: 'traces' });
  fakeClient.getTrace.mockResolvedValue({ ran: 'trace' });
});

describe('filterGrafanaToolDefs (per-signal gating)', () => {
  it('hides query tools whose signal is absent; always offers signal-less tools', () => {
    const defs = grafanaToolDefs();
    const filtered = filterGrafanaToolDefs(defs, { hasConnection: true, signals: new Set(['metrics'] as const) });
    const names = filtered.map((d) => d.name);
    expect(names).toContain('integration.grafana.list_scope');
    expect(names).toContain('integration.grafana.describe_datasets');
    expect(names).toContain('integration.grafana.query_metrics');
    expect(names).not.toContain('integration.grafana.query_logs');
    expect(names).not.toContain('integration.grafana.get_trace');
  });

  it('returns nothing when unbound', () => {
    expect(filterGrafanaToolDefs(grafanaToolDefs(), { hasConnection: false, signals: new Set() })).toHaveLength(0);
  });

  it('maps every query tool to a signal', () => {
    for (const t of ['query_metrics', 'query_logs', 'list_traces', 'get_trace', 'error_rate_summary', 'latency_summary', 'log_error_summary']) {
      expect(SIGNAL_OF[t]).toBeDefined();
    }
  });
});

describe('callGrafanaTool (scope + datasource resolution)', () => {
  it('no connection ⇒ isError', async () => {
    getGrafanaProjectConnection.mockResolvedValueOnce(null);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.list_scope', {});
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no Grafana connection/);
  });

  it('list_scope reports unrestricted with the connection datasources', async () => {
    withDatasources([{ uid: 'p1', name: 'Prom', type: 'prometheus' }]);
    listGrafanaTargets.mockResolvedValue([]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.list_scope', {});
    expect(JSON.parse(r.content)).toEqual({
      unrestricted: true,
      datasources: [{ uid: 'p1', type: 'prometheus', name: 'Prom' }],
    });
  });

  it('auto-selects the single in-scope metrics datasource', async () => {
    withDatasources([{ uid: 'p1', name: 'Prom', type: 'prometheus' }]);
    listGrafanaTargets.mockResolvedValue([]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.query_metrics', { query: 'up' });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content)).toEqual({ ran: 'metrics' });
    expect(fakeClient.queryMetrics).toHaveBeenCalledWith('https://grafana.io', { Authorization: 'Bearer tok' }, 'p1', expect.objectContaining({ query: 'up' }));
  });

  it('rejects a datasourceUid outside the restricted scope', async () => {
    withDatasources([
      { uid: 'p1', name: 'Prom', type: 'prometheus' },
      { uid: 'l1', name: 'Loki', type: 'loki' },
    ]);
    // Restrict to only p1
    listGrafanaTargets.mockResolvedValue([
      { datasourceUid: 'p1', datasourceType: 'prometheus', name: 'Prom' },
    ]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.query_metrics', { query: 'up', datasourceUid: 'l1' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not in this project's scope/);
  });

  it('errors when the metrics datasource is ambiguous (two prometheus, no uid)', async () => {
    withDatasources([
      { uid: 'p1', name: 'A', type: 'prometheus' },
      { uid: 'p2', name: 'B', type: 'prometheus' },
    ]);
    listGrafanaTargets.mockResolvedValue([]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.query_metrics', { query: 'up' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/multiple metrics datasources/);
  });

  it('connection not found ⇒ isError with "connection not found"', async () => {
    getGrafanaProjectConnection.mockResolvedValueOnce({ connectionId: 'c1', orgId: 'o1' });
    getGrafanaConnection.mockResolvedValueOnce(null);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.query_metrics', { query: 'up' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/connection not found/i);
  });

  it('query_logs auto-selects the single loki datasource', async () => {
    withDatasources([{ uid: 'l1', name: 'Loki', type: 'loki' }]);
    listGrafanaTargets.mockResolvedValue([]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.query_logs', { query: '{app="api"}' });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content)).toEqual({ ran: 'logs' });
    expect(fakeClient.queryLogs).toHaveBeenCalledWith('https://grafana.io', { Authorization: 'Bearer tok' }, 'l1', expect.objectContaining({ query: '{app="api"}' }));
  });

  it('get_trace auto-selects the single tempo datasource', async () => {
    withDatasources([{ uid: 't1', name: 'Tempo', type: 'tempo' }]);
    listGrafanaTargets.mockResolvedValue([]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.get_trace', { traceId: 'abc' });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content)).toEqual({ ran: 'trace' });
    expect(fakeClient.getTrace).toHaveBeenCalledWith('https://grafana.io', { Authorization: 'Bearer tok' }, 't1', 'abc');
  });

  it('latency_summary aggregates p50/p95/p99 from queryMetrics', async () => {
    withDatasources([{ uid: 'p1', name: 'Prom', type: 'prometheus' }]);
    listGrafanaTargets.mockResolvedValue([]);
    const r = await callGrafanaTool({ ...ctx(), client: fakeClient }, 'integration.grafana.latency_summary', {});
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(r.content);
    expect(parsed).toHaveProperty('p50');
    expect(parsed).toHaveProperty('p95');
    expect(parsed).toHaveProperty('p99');
    expect(fakeClient.queryMetrics).toHaveBeenCalledTimes(3);
  });
});
