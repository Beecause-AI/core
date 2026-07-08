import { describe, expect, it, vi } from 'vitest';
import { datadogToolDefs, filterDatadogToolDefs, callDatadogTool, SIGNAL_OF } from '../src/integrations/datadog/tools.js';
import { makeDatadogClientForTest } from '@intellilabs/core';

// ── Minimal fake Db for tests ──────────────────────────────────────────────
type FakeDoc = { id: string; [k: string]: unknown };

function fakeDb(collections: Record<string, FakeDoc[]>) {
  const store = new Map<string, FakeDoc[]>();
  for (const [k, v] of Object.entries(collections)) store.set(k, v);
  // The DocStore port's Query.get() resolves to a Snapshot[] (array), not a { docs } wrapper.
  const col = (name: string) => ({
    where: (field: string, op: string, val: unknown) => ({
      where: (f2: string, op2: string, v2: unknown) => ({
        get: async () => {
          const docs = (store.get(name) ?? []).filter((d) => {
            const m1 = op === '==' ? d[field] === val : true;
            const m2 = op2 === '==' ? d[f2] === v2 : true;
            return m1 && m2;
          });
          return docs.map((d) => ({ id: d.id, exists: true, data: () => d }));
        },
      }),
      get: async () => {
        const docs = (store.get(name) ?? []).filter((d) =>
          op === '==' ? d[field] === val : true,
        );
        return docs.map((d) => ({ id: d.id, exists: true, data: () => d }));
      },
    }),
    doc: (id: string) => ({
      get: async () => {
        const docs = store.get(name) ?? [];
        const doc = docs.find((d) => d.id === id);
        return { exists: !!doc, data: () => doc };
      },
    }),
  });
  return { collection: (name: string) => col(name) } as unknown as import('@intellilabs/core').Db;
}

// A target + connection for tests
const TARGET = {
  id: 't1',
  projectId: 'proj1',
  connectionId: 'conn1',
  env: 'prod',
  service: 'checkout',
  label: null,
  metadata: {},
  addedByUserId: 'u1',
  createdAt: new Date(),
};

const CONN = {
  id: 'conn1',
  orgId: 'org1',
  projectId: null,
  name: 'Test DD',
  mode: 'api_keys',
  site: 'us1',
  // A real encrypted secret would be needed in a real test; here we inject a client directly
  secretCiphertext: 'placeholder',
  secretHint: '…1234',
  metadata: { availableSignals: ['metrics', 'logs', 'traces', 'alerts'] },
  enabled: true,
  lastTestedAt: null,
  lastTestOk: null,
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeDb(targets: FakeDoc[] = [TARGET], conns: FakeDoc[] = [CONN]) {
  return fakeDb({ datadog_targets: targets, datadog_connections: conns });
}

describe('datadogToolDefs / SIGNAL_OF', () => {
  it('defines 11 integration.datadog.* tools, all read-only', () => {
    const defs = datadogToolDefs();
    expect(defs.length).toBe(11);
    expect(defs.every((d) => d.name.startsWith('integration.datadog.') && d.mutates === false)).toBe(true);
    expect(defs.map((d) => d.name)).toContain('integration.datadog.list_scope');
    expect(defs.map((d) => d.name)).toContain('integration.datadog.query_metrics');
    expect(defs.map((d) => d.name)).toContain('integration.datadog.list_monitors');
  });

  it('maps each signal-bearing tool to a signal', () => {
    expect(SIGNAL_OF['query_metrics']).toBe('metrics');
    expect(SIGNAL_OF['list_metrics']).toBe('metrics');
    expect(SIGNAL_OF['query_logs']).toBe('logs');
    expect(SIGNAL_OF['log_error_summary']).toBe('logs');
    expect(SIGNAL_OF['list_traces']).toBe('traces');
    expect(SIGNAL_OF['error_rate_summary']).toBe('traces');
    expect(SIGNAL_OF['latency_summary']).toBe('traces');
    expect(SIGNAL_OF['list_monitors']).toBe('alerts');
  });
});

describe('filterDatadogToolDefs', () => {
  const defs = datadogToolDefs();

  it('returns nothing when the project has no scope', () => {
    expect(filterDatadogToolDefs(defs, { hasScope: false, signals: new Set() })).toEqual([]);
  });

  it('always keeps list_scope/describe_datasets, gates the rest by signal', () => {
    const out = filterDatadogToolDefs(defs, { hasScope: true, signals: new Set(['metrics']) });
    const names = out.map((d) => d.name.replace('integration.datadog.', ''));
    expect(names).toContain('list_scope');
    expect(names).toContain('describe_datasets');
    expect(names).toContain('query_metrics');
    expect(names).toContain('list_metrics');
    expect(names).not.toContain('query_logs');
    expect(names).not.toContain('list_traces');
    expect(names).not.toContain('list_monitors');
  });

  it('drops query_metrics when metrics is not in signals', () => {
    const out = filterDatadogToolDefs(defs, { hasScope: true, signals: new Set(['logs']) });
    const names = out.map((d) => d.name.replace('integration.datadog.', ''));
    expect(names).not.toContain('query_metrics');
    expect(names).toContain('query_logs');
  });
});

describe('callDatadogTool', () => {
  const client = makeDatadogClientForTest({
    searchLogs: vi.fn(async () => ({ data: [{ id: 'log1', content: { message: 'boom' } }] })),
    queryMetrics: vi.fn(async () => ({ series: [] })),
    listMonitors: vi.fn(async () => [{ id: 1, name: 'CPU' }]),
    aggregateLogs: vi.fn(async () => ({ data: { buckets: [{ by: {}, computes: {} }] } })),
    searchSpans: vi.fn(async () => ({ data: [] })),
    aggregateSpans: vi.fn(async () => ({ data: { buckets: [] } })),
  });

  it('list_scope returns configured targets', async () => {
    const db = makeDb();
    const res = await callDatadogTool({ db, orgId: 'org1', projectId: 'proj1', config: {}, client }, 'integration.datadog.list_scope', {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.scope).toHaveLength(1);
    expect(parsed.scope[0].env).toBe('prod');
    expect(parsed.scope[0].service).toBe('checkout');
  });

  it('list_scope returns empty when no targets', async () => {
    const db = makeDb([]);
    const res = await callDatadogTool({ db, orgId: 'org1', projectId: 'proj1', config: {}, client }, 'integration.datadog.list_scope', {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.scope).toHaveLength(0);
  });

  it('query_logs with an out-of-scope (env, service) returns isError:true', async () => {
    const db = makeDb(); // only has prod/checkout
    const res = await callDatadogTool(
      { db, orgId: 'org1', projectId: 'proj1', config: {}, client },
      'integration.datadog.query_logs',
      { env: 'staging', service: 'checkout', query: 'status:error' },
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('staging');
  });

  it('query_logs with an in-scope target calls client.searchLogs with tag filter', async () => {
    const db = makeDb();
    const res = await callDatadogTool(
      { db, orgId: 'org1', projectId: 'proj1', config: {}, client },
      'integration.datadog.query_logs',
      { env: 'prod', service: 'checkout', query: 'status:error', window: '1h' },
    );
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.data).toBeDefined();
    expect(client.searchLogs).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'api_keys' }),
      expect.objectContaining({ query: expect.stringContaining('env:prod') }),
    );
  });

  it('auto-defaults to the only target when no env given', async () => {
    const db = makeDb(); // only one target: prod/checkout
    const res = await callDatadogTool(
      { db, orgId: 'org1', projectId: 'proj1', config: {}, client },
      'integration.datadog.query_logs',
      { query: 'status:error', window: '1h' }, // no env/service
    );
    expect(res.isError).toBeFalsy();
    expect(client.searchLogs).toHaveBeenCalled();
  });

  it('returns an error when no scope is configured and calling a data tool', async () => {
    const db = makeDb([]);
    const res = await callDatadogTool(
      { db, orgId: 'org1', projectId: 'proj1', config: {}, client },
      'integration.datadog.query_logs',
      { env: 'prod', query: 'status:error' },
    );
    expect(res.isError).toBe(true);
  });

  it('describe_datasets returns a non-empty reference string', async () => {
    const db = makeDb();
    const res = await callDatadogTool({ db, orgId: 'org1', projectId: 'proj1', config: {}, client }, 'integration.datadog.describe_datasets', {});
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('Datadog');
  });

  it('list_monitors calls client.listMonitors', async () => {
    const db = makeDb([{ ...TARGET, service: null }]);
    const res = await callDatadogTool(
      { db, orgId: 'org1', projectId: 'proj1', config: {}, client },
      'integration.datadog.list_monitors',
      { env: 'prod', window: '1h' },
    );
    expect(res.isError).toBeFalsy();
    expect(client.listMonitors).toHaveBeenCalled();
  });
});
