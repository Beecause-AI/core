import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  listAwsTargets,
  listAwsConnectionsForProject,
  getAwsConnection,
  credsForAwsConnection,
  resolveAwsCreds,
} = vi.hoisted(() => ({
  listAwsTargets: vi.fn(async () => [] as any[]),
  listAwsConnectionsForProject: vi.fn(async () => [] as any[]),
  getAwsConnection: vi.fn(async () => ({ id: 'c1', mode: 'key', secretCiphertext: 'ct', metadata: { availableSignals: ['metrics'] } }) as any),
  credsForAwsConnection: vi.fn(() => ({ mode: 'key', accessKeyId: 'AK', secretCiphertext: 'ct' })),
  resolveAwsCreds: vi.fn(async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: undefined })),
}));

vi.mock('@intellilabs/core', () => ({
  listAwsTargets,
  listAwsConnectionsForProject,
  getAwsConnection,
  credsForAwsConnection,
  resolveAwsCreds,
  // Pure helpers — faithful real implementations
  awsScopeKey: (a: string, r: string) => `${a}:${r}`,
  validateAwsScope: (a: string, r: string, allowed: { pairs: Set<string> }) =>
    allowed.pairs.has(`${a}:${r}`) ? { ok: true } : { ok: false, error: 'out of scope' },
  latencyStatistics: () => ['p50', 'p95', 'p99'],
  logErrorQuery: () => 'fields @timestamp',
  // realAwsClient is never used — tests always inject ctx.client
  realAwsClient: {},
}));

import { awsToolDefs, filterAwsToolDefs, callAwsTool, SIGNAL_OF } from './tools.js';

const ctx = () => ({ db: {} as any, orgId: 'o1', projectId: 'p1', config: { SECRETS_KEY: 'k' } as any });

const TARGET = { awsAccountId: '111122223333', awsRegion: 'us-east-1', connectionId: 'c1', label: 'Prod' };

beforeEach(() => {
  vi.clearAllMocks();
  listAwsTargets.mockResolvedValue([]);
  listAwsConnectionsForProject.mockResolvedValue([]);
  getAwsConnection.mockResolvedValue({ id: 'c1', mode: 'key', secretCiphertext: 'ct', metadata: { availableSignals: ['metrics'] } });
  credsForAwsConnection.mockReturnValue({ mode: 'key', accessKeyId: 'AK', secretCiphertext: 'ct' });
  resolveAwsCreds.mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: undefined });
});

// ─────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────

describe('awsToolDefs / SIGNAL_OF', () => {
  it('defines integration.aws.* tools, all read-only', () => {
    const defs = awsToolDefs();
    expect(defs.every((d) => d.name.startsWith('integration.aws.') && d.mutates === false)).toBe(true);
    expect(defs.map((d) => d.name)).toContain('integration.aws.query_metrics');
    expect(defs.map((d) => d.name)).toContain('integration.aws.list_scope');
  });

  it('maps each signal-bearing tool to a signal', () => {
    expect(SIGNAL_OF.query_metrics).toBe('metrics');
    expect(SIGNAL_OF.query_logs).toBe('logs');
    expect(SIGNAL_OF.list_traces).toBe('traces');
    expect(SIGNAL_OF.list_alarms).toBe('alarms');
  });
});

describe('filterAwsToolDefs', () => {
  const defs = awsToolDefs();

  it('returns nothing when the project has no scope', () => {
    expect(filterAwsToolDefs(defs, { hasScope: false, signals: new Set() })).toEqual([]);
  });

  it('always keeps list_scope/describe_datasets, gates the rest by signal', () => {
    const out = filterAwsToolDefs(defs, { hasScope: true, signals: new Set(['metrics'] as const) });
    const names = out.map((d) => d.name.replace('integration.aws.', ''));
    expect(names).toContain('list_scope');
    expect(names).toContain('describe_datasets');
    expect(names).toContain('query_metrics');
    expect(names).not.toContain('query_logs');
    expect(names).not.toContain('list_traces');
  });
});

// ─────────────────────────────────────────────
// Dispatcher: callAwsTool
// ─────────────────────────────────────────────

describe('callAwsTool', () => {
  it('no targets → isError (no AWS scope)', async () => {
    listAwsTargets.mockResolvedValue([]);
    const r = await callAwsTool(ctx(), 'integration.aws.query_metrics', { namespace: 'X', metricName: 'Y' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no AWS scope/i);
  });

  it('list_scope → JSON listing account/region for targets', async () => {
    listAwsTargets.mockResolvedValue([TARGET]);
    listAwsConnectionsForProject.mockResolvedValue([
      { id: 'c1', metadata: { availableSignals: ['metrics'] } },
    ]);
    const r = await callAwsTool(ctx(), 'integration.aws.list_scope', {});
    expect(r.isError).toBeUndefined();
    const parsed = JSON.parse(r.content);
    expect(parsed.scope).toHaveLength(1);
    expect(parsed.scope[0].account).toBe('111122223333');
    expect(parsed.scope[0].region).toBe('us-east-1');
  });

  it('out-of-scope region → isError', async () => {
    listAwsTargets.mockResolvedValue([TARGET]); // only us-east-1 in scope
    const r = await callAwsTool(ctx(), 'integration.aws.query_metrics', {
      account: '111122223333',
      region: 'eu-west-1', // NOT in scope
      namespace: 'X',
      metricName: 'Y',
    });
    expect(r.isError).toBe(true);
  });

  it('single-target auto-resolution: calls client.queryMetrics and returns result', async () => {
    listAwsTargets.mockResolvedValue([TARGET]);
    const stubClient = {
      queryMetrics: vi.fn(async () => ({ ok: true })),
    };
    const r = await callAwsTool(
      { ...ctx(), client: stubClient as any },
      'integration.aws.query_metrics',
      { namespace: 'AWS/Lambda', metricName: 'Invocations' },
    );
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content)).toEqual({ ok: true });
    expect(stubClient.queryMetrics).toHaveBeenCalled();
  });
});
