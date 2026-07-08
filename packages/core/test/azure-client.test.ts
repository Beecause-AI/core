import { describe, expect, it, vi, beforeEach } from 'vitest';

const queryWorkspace = vi.fn();
const queryResource = vi.fn();
const alertsGetAll = vi.fn();
const metricDefsList = vi.fn();

vi.mock('@azure/monitor-query', () => ({
  LogsQueryClient: vi.fn().mockImplementation(() => ({ queryWorkspace })),
  MetricsQueryClient: vi.fn().mockImplementation(() => ({ queryResource })),
}));
vi.mock('@azure/arm-alertsmanagement', () => ({
  AlertsManagementClient: vi.fn().mockImplementation(() => ({ alerts: { getAll: alertsGetAll } })),
}));
vi.mock('@azure/arm-monitor', () => ({
  MonitorClient: vi.fn().mockImplementation(() => ({ metricDefinitions: { list: metricDefsList } })),
}));

const { realAzureClient, resolveWindow } = await import('../src/azure/client.js');

const cred = { getToken: vi.fn().mockResolvedValue({ token: 'tok', expiresOnTimestamp: 0 }) } as any;

async function* aiter(items: unknown[]) { for (const i of items) yield i; }

beforeEach(() => { queryWorkspace.mockReset(); queryResource.mockReset(); alertsGetAll.mockReset(); metricDefsList.mockReset(); cred.getToken.mockClear(); });

describe('resolveWindow', () => {
  it('resolves a relative window to start/end', () => {
    const now = new Date('2026-06-25T12:00:00Z');
    const { start, end } = resolveWindow({ window: '1h', now });
    expect(end.toISOString()).toBe('2026-06-25T12:00:00.000Z');
    expect(start.toISOString()).toBe('2026-06-25T11:00:00.000Z');
  });
});

describe('realAzureClient', () => {
  it('checkCredential fetches an ARM token', async () => {
    await realAzureClient.checkCredential(cred);
    expect(cred.getToken).toHaveBeenCalledWith('https://management.azure.com/.default');
  });

  it('queryLogs runs KQL against the workspace', async () => {
    queryWorkspace.mockResolvedValue({ status: 'Success', tables: [{ name: 'PrimaryResult', rows: [[1]] }] });
    const out = await realAzureClient.queryLogs(cred, { workspaceId: 'ws-1', query: 'AppRequests | take 1', window: '1h' }) as any;
    expect(out.tables[0].rows).toEqual([[1]]);
    expect(queryWorkspace).toHaveBeenCalled();
    const [wsArg, queryArg] = queryWorkspace.mock.calls[0]!;
    expect(wsArg).toBe('ws-1');
    expect(queryArg).toContain('AppRequests');
  });

  it('listAlerts collects the async iterator with a cap', async () => {
    // getAll(scope, options?) — scope is /subscriptions/{sub}
    alertsGetAll.mockReturnValue(aiter([{ name: 'a1' }, { name: 'a2' }]));
    const out = await realAzureClient.listAlerts(cred, { subscriptionId: 'sub-1', limit: 50 }) as any;
    expect(out.alerts.map((a: any) => a.name)).toEqual(['a1', 'a2']);
    // Verify scope was passed as first arg
    expect(alertsGetAll.mock.calls[0]![0]).toBe('/subscriptions/sub-1');
  });

  it('listMetrics collects metric definitions', async () => {
    metricDefsList.mockReturnValue(aiter([{ name: { value: 'Requests' } }]));
    const out = await realAzureClient.listMetrics(cred, { subscriptionId: 'sub-1', resourceId: '/subscriptions/sub-1/x' }) as any;
    expect(out.metricDefinitions[0].name.value).toBe('Requests');
  });

  it('checkCredential throws when getToken returns nothing', async () => {
    const badCred = { getToken: vi.fn().mockResolvedValue(null) } as any;
    await expect(realAzureClient.checkCredential(badCred)).rejects.toThrow();
  });

  it('queryMetrics forwards resourceId + metricNames to queryResource', async () => {
    const cannedResult = { metrics: [{ name: 'Http5xx', timeseries: [] }] };
    queryResource.mockResolvedValue(cannedResult);
    const resourceId = '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Web/sites/app';
    const out = await realAzureClient.queryMetrics(cred, {
      subscriptionId: 'sub-1',
      resourceId,
      metricNames: ['Http5xx'],
      aggregations: ['Total'],
      period: 300,
      window: '1h',
    });
    expect(out).toBe(cannedResult);
    expect(queryResource).toHaveBeenCalledTimes(1);
    const [resIdArg, metricsArg, optsArg] = queryResource.mock.calls[0]!;
    expect(resIdArg).toBe(resourceId);
    expect(metricsArg).toEqual(['Http5xx']);
    expect(optsArg).toMatchObject({
      timespan: { startTime: expect.any(Date), endTime: expect.any(Date) },
    });
  });
});
