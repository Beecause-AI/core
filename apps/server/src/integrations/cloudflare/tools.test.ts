import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryGraphql, queryWorkerLogs, listCloudflareTargets, getProjectConnection, getConnection } = vi.hoisted(() => ({
  queryGraphql: vi.fn(async () => ({ data: { viewer: {} } })),
  queryWorkerLogs: vi.fn(async () => ({ result: [] })),
  listCloudflareTargets: vi.fn(async () => [] as any[]),
  getProjectConnection: vi.fn(async () => ({ connectionId: 'c1' }) as any),
  getConnection: vi.fn(async () => ({ id: 'c1', mode: 'api_token', secretCiphertext: 'ct', metadata: { accountId: 'a1' } }) as any),
}));

vi.mock('@intellilabs/core', () => ({
  getProjectConnection,
  getConnection,
  listCloudflareTargets,
  cfCredsForConnection: vi.fn(() => ({ mode: 'api_token', apiToken: 'tok' })),
  cfAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer tok' })),
  realCloudflareClient: { queryGraphql, queryWorkerLogs },
  validateGraphqlScopes: vi.fn(() => ({ ok: true })),
  httpErrorSummary: (scope: any) => 'Q zone ' + scope.zoneTag,
  latencySummary: (scope: any) => 'Q zone ' + scope.zoneTag,
  firewallEvents: (scope: any) => 'Q zone ' + scope.zoneTag,
  workerErrors: (scope: any) => 'Q account ' + scope.accountTag,
}));

import { cloudflareToolDefs, filterCloudflareToolDefs, callCloudflareTool } from './tools.js';

const ctx = () => ({ db: {} as any, orgId: 'o1', projectId: 'p1', config: { SECRETS_KEY: 'k' } });
const ZONE_RESOURCE = { kind: 'zone', zoneId: 'z1', accountId: 'a1', name: 'beecause.ai' };

beforeEach(() => {
  vi.clearAllMocks();
  listCloudflareTargets.mockResolvedValue([]); // unrestricted by default
  getProjectConnection.mockResolvedValue({ connectionId: 'c1' });
  getConnection.mockResolvedValue({ id: 'c1', mode: 'api_token', secretCiphertext: 'ct', metadata: { accountId: 'a1' } });
});

describe('cloudflareToolDefs / filter', () => {
  it('defines the seven tools', () => {
    expect(cloudflareToolDefs().map((d) => d.name.replace('integration.cloudflare.', '')).sort()).toEqual([
      'describe_datasets',
      'firewall_events',
      'http_error_summary',
      'latency_summary',
      'list_scope',
      'query_graphql',
      'query_worker_logs',
      'worker_errors',
    ]);
  });
  it('returns nothing when there is no connection', () => {
    expect(filterCloudflareToolDefs(cloudflareToolDefs(), false)).toEqual([]);
  });
  it('returns all defs when there is a connection', () => {
    expect(filterCloudflareToolDefs(cloudflareToolDefs(), true)).toHaveLength(cloudflareToolDefs().length);
  });
});

describe('callCloudflareTool', () => {
  it('no connection ⇒ isError', async () => {
    getProjectConnection.mockResolvedValueOnce(null);
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.list_scope', {});
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no Cloudflare connection/);
  });

  it('list_scope shows unrestricted when no resources', async () => {
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.list_scope', {});
    expect(JSON.parse(r.content)).toEqual({ account: 'a1', unrestricted: true, resources: [] });
  });

  it('list_scope lists resources when restricted', async () => {
    listCloudflareTargets.mockResolvedValue([ZONE_RESOURCE]);
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.list_scope', {});
    const parsed = JSON.parse(r.content);
    expect(parsed.unrestricted).toBe(false);
    expect(parsed.resources).toEqual([{ kind: 'zone', name: 'beecause.ai', accountId: 'a1', zoneId: 'z1' }]);
  });

  it('describe_datasets returns the reference text', async () => {
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.describe_datasets', {});
    expect(r.content).toMatch(/httpRequestsAdaptiveGroups/);
  });

  it('http_error_summary allows any zone when unrestricted', async () => {
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.http_error_summary', { zone: 'whatever', window: '1h' });
    expect(r.isError).toBeUndefined();
    expect(queryGraphql).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('whatever'));
  });

  it('http_error_summary rejects a zone not in scope when restricted', async () => {
    listCloudflareTargets.mockResolvedValue([ZONE_RESOURCE]);
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.http_error_summary', { zone: 'z-other', window: '1h' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not in this project's scope/);
    expect(queryGraphql).not.toHaveBeenCalled();
  });

  it('http_error_summary allows a zone in scope when restricted', async () => {
    listCloudflareTargets.mockResolvedValue([ZONE_RESOURCE]);
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.http_error_summary', { zone: 'z1', window: '1h' });
    expect(r.isError).toBeUndefined();
    expect(queryGraphql).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('z1'));
  });

  it('worker_errors defaults account to the connection account', async () => {
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.worker_errors', { window: '1h' });
    expect(r.isError).toBeUndefined();
    expect(queryGraphql).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('a1'));
  });

  it('query_worker_logs defaults account and forwards window', async () => {
    const r = await callCloudflareTool(ctx(), 'integration.cloudflare.query_worker_logs', { window: '15m' });
    expect(r.isError).toBeUndefined();
    expect(queryWorkerLogs).toHaveBeenCalledWith(
      { Authorization: 'Bearer tok' },
      'a1',
      expect.objectContaining({ window: '15m' }),
    );
  });
});
