import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@intellilabs/core', () => ({
  getGcpProjectConnection: vi.fn(),
  getGcpConnection: vi.fn(),
  listGcpTargets: vi.fn(),
  credsForConnection: vi.fn(() => ({ mode: 'sa_key', saJson: '{}' })),
  validateGcpScope: vi.fn(() => ({ ok: true })),
  mintToken: vi.fn(async () => 'tok'),
  GCP_READONLY_SCOPES: ['scope'],
  GCP_ERRORREPORTING_SCOPES: ['cloud-platform'],
  realGcpClient: {},
  errorRatePromQL: () => 'ERR_PROMQL',
  latencyPromQL: () => 'LAT_PROMQL',
  logErrorFilter: () => 'severity>=ERROR',
}));

import {
  getGcpProjectConnection, getGcpConnection, listGcpTargets, validateGcpScope, mintToken,
} from '@intellilabs/core';
import { callGcpTool, gcpToolDefs, type GcpToolCtx } from '../src/integrations/gcp/tools.js';

const queryMetrics = vi.fn(async () => ({ ok: 'metrics' }));
const queryLogs = vi.fn(async () => ({ ok: 'logs' }));
const listTraces = vi.fn(async () => ({ ok: 'traces' }));
const getTrace = vi.fn(async () => ({ ok: 'trace' }));
const listMetricDescriptors = vi.fn(async () => ({ ok: 'descriptors' }));
const listErrorGroups = vi.fn(async () => ({ ok: 'error-groups' }));
const getErrorGroup = vi.fn(async () => ({ ok: 'error-group' }));

const client = { queryMetrics, queryLogs, listTraces, getTrace, listMetricDescriptors, listErrorGroups, getErrorGroup } as any;
const ctx: GcpToolCtx = {
  db: {} as any, orgId: 'org1', projectId: 'proj1', config: { SECRETS_KEY: 'k' }, client,
};

const conn = { id: 'c1', mode: 'sa_key', secretCiphertext: 'ct', metadata: { defaultGcpProjectId: 'default-proj' } };

beforeEach(() => {
  vi.clearAllMocks();
  (getGcpProjectConnection as any).mockResolvedValue({ connectionId: 'c1' });
  (getGcpConnection as any).mockResolvedValue(conn);
  (listGcpTargets as any).mockResolvedValue([]); // unrestricted by default
  (validateGcpScope as any).mockReturnValue({ ok: true });
  (mintToken as any).mockResolvedValue('tok');
});

describe('callGcpTool', () => {
  it('errors when no project binding exists', async () => {
    (getGcpProjectConnection as any).mockResolvedValue(null);
    const res = await callGcpTool(ctx, 'integration.gcp.list_scope', {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no GCP connection/i);
  });

  it('list_scope reports unrestricted when there are no targets', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.list_scope', {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.unrestricted).toBe(true);
    expect(parsed.projects).toEqual([]);
    expect(parsed.connectionDefaultProject).toBe('default-proj');
  });

  it('list_scope reports the allowed projects when restricted', async () => {
    (listGcpTargets as any).mockResolvedValue([
      { gcpProjectId: 'p-a', label: 'A' },
      { gcpProjectId: 'p-b', label: 'B' },
    ]);
    const res = await callGcpTool(ctx, 'integration.gcp.list_scope', {});
    const parsed = JSON.parse(res.content);
    expect(parsed.unrestricted).toBe(false);
    expect(parsed.projects).toEqual([
      { gcpProjectId: 'p-a', label: 'A' },
      { gcpProjectId: 'p-b', label: 'B' },
    ]);
  });

  it('error_rate_summary requires gcpProject when scope is unrestricted', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.error_rate_summary', {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/gcpProject is required/i);
    expect(queryMetrics).not.toHaveBeenCalled();
  });

  it('error_rate_summary runs with an explicit gcpProject', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.error_rate_summary', { gcpProject: 'p-a', window: '1h' });
    expect(res.isError).toBeFalsy();
    expect(queryMetrics).toHaveBeenCalledTimes(1);
    const [token, project, opts] = queryMetrics.mock.calls[0] as any;
    expect(token).toBe('tok');
    expect(project).toBe('p-a');
    expect(opts.query).toBe('ERR_PROMQL');
    expect(opts.window).toBe('1h');
  });

  it('rejects an out-of-scope project', async () => {
    (listGcpTargets as any).mockResolvedValue([{ gcpProjectId: 'p-a', label: 'A' }]);
    (validateGcpScope as any).mockReturnValue({ ok: false, error: 'out of scope' });
    const res = await callGcpTool(ctx, 'integration.gcp.query_metrics', { gcpProject: 'evil', query: 'up' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/out of scope/);
    expect(queryMetrics).not.toHaveBeenCalled();
  });

  it('latency_summary queries each percentile with the minted token', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.latency_summary', { gcpProject: 'proj-a', window: '1h' });
    expect(res.isError).toBeFalsy();
    expect(queryMetrics).toHaveBeenCalledTimes(3);
    for (const call of queryMetrics.mock.calls) {
      expect((call as any)[0]).toBe('tok');
    }
    const parsed = JSON.parse(res.content);
    expect(parsed).toHaveProperty('p50');
    expect(parsed).toHaveProperty('p95');
    expect(parsed).toHaveProperty('p99');
  });

  it('list_error_groups dispatches to the client with a minted token', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.list_error_groups', { gcpProject: 'p-a', window: '1h', limit: 5 });
    expect(JSON.parse(res.content)).toEqual({ ok: 'error-groups' });
    const [token, project, opts] = listErrorGroups.mock.calls[0] as any;
    expect(token).toBe('tok');
    expect(project).toBe('p-a');
    expect(opts.window).toBe('1h');
    expect(opts.limit).toBe(5);
  });

  it('get_error_group requires a groupId', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.get_error_group', { gcpProject: 'p-a' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/groupId is required/i);
    expect(getErrorGroup).not.toHaveBeenCalled();
  });

  it('get_error_group dispatches with the groupId', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.get_error_group', { gcpProject: 'p-a', groupId: 'grp-1' });
    expect(JSON.parse(res.content)).toEqual({ ok: 'error-group' });
    const [token, project, opts] = getErrorGroup.mock.calls[0] as any;
    expect(token).toBe('tok');
    expect(project).toBe('p-a');
    expect(opts.groupId).toBe('grp-1');
  });

  it('errors tools mint the cloud-platform scope, not the read-only scopes', async () => {
    await callGcpTool(ctx, 'integration.gcp.list_error_groups', { gcpProject: 'p-a' });
    const [, scopes] = (mintToken as any).mock.calls[0];
    expect(scopes).toEqual(['cloud-platform']);
  });

  it('non-errors tools mint the read-only scopes', async () => {
    await callGcpTool(ctx, 'integration.gcp.query_metrics', { gcpProject: 'p-a', query: 'up' });
    const [, scopes] = (mintToken as any).mock.calls[0];
    expect(scopes).toEqual(['scope']);
  });

  it('query_metrics dispatches to the client with a minted token', async () => {
    const res = await callGcpTool(ctx, 'integration.gcp.query_metrics', { gcpProject: 'p-a', query: 'up' });
    expect(JSON.parse(res.content)).toEqual({ ok: 'metrics' });
    const [token, project, opts] = queryMetrics.mock.calls[0] as any;
    expect(token).toBe('tok');
    expect(project).toBe('p-a');
    expect(opts.query).toBe('up');
  });
});

describe('gcpToolDefs', () => {
  it('includes recipe + raw + list_scope tools, all read-only', () => {
    const names = gcpToolDefs().map((d) => d.name);
    expect(names).toContain('integration.gcp.list_scope');
    expect(names).toContain('integration.gcp.describe_datasets');
    expect(names).toContain('integration.gcp.query_metrics');
    expect(names).toContain('integration.gcp.query_logs');
    expect(names).toContain('integration.gcp.list_traces');
    expect(names).toContain('integration.gcp.get_trace');
    expect(names).toContain('integration.gcp.list_metric_descriptors');
    expect(names).toContain('integration.gcp.error_rate_summary');
    expect(names).toContain('integration.gcp.latency_summary');
    expect(names).toContain('integration.gcp.log_error_summary');
    expect(names).toContain('integration.gcp.list_error_groups');
    expect(names).toContain('integration.gcp.get_error_group');
    expect(gcpToolDefs().every((d) => d.mutates === false)).toBe(true);
  });
});
