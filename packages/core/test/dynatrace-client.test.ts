import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveDynatraceWindow, realDynatraceClient } from '../src/index.js';

const creds = { mode: 'api_token' as const, environmentUrl: 'https://t.live.dynatrace.com', apiToken: 'dt0c01.TOK' };

afterEach(() => vi.restoreAllMocks());

describe('dynatrace client', () => {
  it('resolves a relative window to Dynatrace now-syntax', () => {
    expect(resolveDynatraceWindow({ window: '15m' })).toEqual({ from: 'now-15m', to: 'now' });
    expect(resolveDynatraceWindow({ window: 'bogus' })).toEqual({ from: 'now-1h', to: 'now' });
  });
  it('resolves explicit start/end to ISO', () => {
    const r = resolveDynatraceWindow({ start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' });
    expect(r.from).toBe('2026-01-01T00:00:00.000Z');
    expect(r.to).toBe('2026-01-01T01:00:00.000Z');
  });
  it('calls Environment API v2 metrics/query with Api-Token header', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: [] }), { status: 200 }));
    await realDynatraceClient.queryMetrics(creds, { metricSelector: 'builtin:service.response.time:avg', window: '1h' });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain('https://t.live.dynatrace.com/api/v2/metrics/query');
    expect(String(url)).toContain('metricSelector=builtin%3Aservice.response.time%3Aavg');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Api-Token dt0c01.TOK' });
  });
  it('throws with .status on non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('forbidden', { status: 403 }));
    await expect(realDynatraceClient.listProblems(creds, {})).rejects.toMatchObject({ status: 403 });
  });
});
