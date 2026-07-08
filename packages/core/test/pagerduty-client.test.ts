import { describe, it, expect, vi, afterEach } from 'vitest';
import { realPagerDutyClient, makePagerDutyClientForTest } from '../src/pagerduty/client.js';

const creds = { mode: 'api_keys' as const, region: 'us' as const, apiToken: 't' };

afterEach(() => vi.restoreAllMocks());

function mockFetchOnce(json: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status, json: async () => json, text: async () => JSON.stringify(json),
  } as Response);
}

describe('realPagerDutyClient', () => {
  it('listIncidents builds the US url with repeated array params + defaults sort', async () => {
    const spy = mockFetchOnce({ incidents: [] });
    await realPagerDutyClient.listIncidents(creds, { statuses: ['triggered', 'resolved'], serviceIds: ['S1'], limit: 5 });
    const url = (spy.mock.calls[0]![0] as string);
    expect(url).toContain('https://api.pagerduty.com/incidents?');
    expect(url).toContain('statuses%5B%5D=triggered');
    expect(url).toContain('statuses%5B%5D=resolved');
    expect(url).toContain('service_ids%5B%5D=S1');
    expect(url).toContain('limit=5');
  });

  it('getIncident hits /incidents/:id', async () => {
    const spy = mockFetchOnce({ incident: { id: 'P1' } });
    await realPagerDutyClient.getIncident(creds, 'P1');
    expect((spy.mock.calls[0]![0] as string)).toBe('https://api.pagerduty.com/incidents/P1');
  });

  it('throws with status on a non-ok response', async () => {
    mockFetchOnce({ error: 'nope' }, false, 401);
    await expect(realPagerDutyClient.validate(creds)).rejects.toMatchObject({ status: 401 });
  });

  it('test client returns canned data', async () => {
    const c = makePagerDutyClientForTest({ listIncidents: async () => ({ incidents: [{ id: 'X' }] }) });
    expect(await c.listIncidents(creds, {})).toEqual({ incidents: [{ id: 'X' }] });
  });
});
