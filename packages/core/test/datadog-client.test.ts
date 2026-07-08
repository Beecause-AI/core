import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Import the module under test AFTER stubbing global fetch
const { realDatadogClient, resolveWindow, makeDatadogClientForTest } = await import('../src/datadog/client.js');

const fakeCreds = { mode: 'api_keys' as const, apiKey: 'test-api-key', appKey: 'test-app-key', site: 'us3' as const };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }));
}

describe('resolveWindow', () => {
  it('resolves a 1h relative window correctly', () => {
    const now = new Date('2026-06-26T12:00:00Z');
    const { fromSec, toSec, fromMs, toMs } = resolveWindow({ window: '1h', now });
    expect(toSec - fromSec).toBe(3600);
    expect(toMs - fromMs).toBe(3_600_000);
    expect(toSec).toBe(Math.floor(now.getTime() / 1000));
  });

  it('resolves a 24h window', () => {
    const now = new Date('2026-06-26T12:00:00Z');
    const { fromSec, toSec } = resolveWindow({ window: '24h', now });
    expect(toSec - fromSec).toBe(86400);
  });

  it('uses 1h as default when no window is given', () => {
    const now = new Date('2026-06-26T12:00:00Z');
    const { fromSec, toSec } = resolveWindow({ now });
    expect(toSec - fromSec).toBe(3600);
  });
});

describe('realDatadogClient', () => {
  it('queryMetrics hits the correct us3 URL with required query params', async () => {
    mockFetch(200, { series: [] });
    await realDatadogClient.queryMetrics(fakeCreds, { query: 'avg:system.cpu.user{env:prod}', window: '1h' });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('https://api.us3.datadoghq.com/api/v1/query');
    expect(url).toContain('query=');
    expect(url).toContain('from=');
    expect(url).toContain('to=');
    expect((opts as RequestInit).headers as Record<string, string>).toMatchObject({
      'DD-API-KEY': 'test-api-key',
      'DD-APPLICATION-KEY': 'test-app-key',
    });
  });

  it('throws with a .status property on non-2xx responses', async () => {
    mockFetch(403, { errors: ['Forbidden'] });
    let thrown: any;
    try {
      await realDatadogClient.validate(fakeCreds);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.status).toBe(403);
    expect(thrown.message).toContain('403');
  });

  it('validate calls /api/v1/validate', async () => {
    mockFetch(200, { valid: true });
    await realDatadogClient.validate(fakeCreds);
    const fetchMock = vi.mocked(fetch);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/v1/validate');
  });

  it('searchLogs POSTs to /api/v2/logs/events/search with query in body', async () => {
    mockFetch(200, { data: [] });
    await realDatadogClient.searchLogs(fakeCreds, { query: 'env:prod status:error', window: '1h', limit: 50 });
    const fetchMock = vi.mocked(fetch);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/v2/logs/events/search');
    expect((opts as RequestInit).method).toBe('POST');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.filter.query).toBe('env:prod status:error');
    expect(body.page.limit).toBe(50);
  });

  it('searchSpans POSTs to /api/v2/spans/events/search', async () => {
    mockFetch(200, { data: [] });
    await realDatadogClient.searchSpans(fakeCreds, { query: 'service:checkout', window: '1h' });
    const fetchMock = vi.mocked(fetch);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/v2/spans/events/search');
    expect((opts as RequestInit).method).toBe('POST');
  });

  it('listMonitors GETs /api/v1/monitor', async () => {
    mockFetch(200, [{ id: 1, name: 'High Error Rate' }]);
    await realDatadogClient.listMonitors(fakeCreds, {});
    const fetchMock = vi.mocked(fetch);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/v1/monitor');
    expect((opts as RequestInit).method).toBe('GET');
  });

  it('makeDatadogClientForTest allows overriding individual methods', async () => {
    const mockValidate = vi.fn().mockResolvedValue(undefined);
    const client = makeDatadogClientForTest({ validate: mockValidate });
    await client.validate(fakeCreds);
    expect(mockValidate).toHaveBeenCalledWith(fakeCreds);
  });
});
