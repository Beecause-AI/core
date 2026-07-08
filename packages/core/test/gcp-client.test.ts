import { describe, expect, it } from 'vitest';
import { makeGcpClientForTest, resolveWindow, windowToPeriod } from '../src/gcp/client.js';

function fetchStub(capture: { url?: string; body?: any }) {
  return async (url: string, init?: any) => {
    capture.url = url;
    capture.body = init?.body ? JSON.parse(init.body) : undefined;
    return { ok: true, status: 200, json: async () => ({ data: { result: [] } }), text: async () => '' } as any;
  };
}

describe('resolveWindow', () => {
  it('turns a window into start/end ISO strings', () => {
    const { start, end } = resolveWindow({ window: '1h', now: new Date('2026-06-14T12:00:00Z') });
    expect(end).toBe('2026-06-14T12:00:00.000Z');
    expect(start).toBe('2026-06-14T11:00:00.000Z');
  });
});

describe('gcp client', () => {
  it('queryMetrics hits the prometheus query endpoint with the PromQL query', async () => {
    const cap: any = {};
    const client = makeGcpClientForTest(fetchStub(cap));
    await client.queryMetrics('tok', 'acme-prod', { query: 'up', window: '5m', now: new Date('2026-06-14T12:00:00Z') });
    expect(cap.url).toContain('/v1/projects/acme-prod/location/global/prometheus/api/v1/query');
  });

  it('queryLogs posts the filter to entries:list scoped to the project', async () => {
    const cap: any = {};
    const client = makeGcpClientForTest(fetchStub(cap));
    await client.queryLogs('tok', 'acme-prod', { filter: 'severity>=ERROR', limit: 10 });
    expect(cap.url).toContain('logging.googleapis.com/v2/entries:list');
    expect(cap.body.resourceNames).toEqual(['projects/acme-prod']);
    expect(cap.body.filter).toContain('severity>=ERROR');
  });

  it('listErrorGroups hits the Error Reporting groupStats endpoint ordered by count', async () => {
    const cap: any = {};
    const client = makeGcpClientForTest(fetchStub(cap));
    await client.listErrorGroups('tok', 'acme-prod', { window: '1h', limit: 10 });
    expect(cap.url).toContain('clouderrorreporting.googleapis.com/v1beta1/projects/acme-prod/groupStats');
    expect(cap.url).toContain('timeRange.period=PERIOD_1_HOUR');
    expect(cap.url).toContain('order=COUNT_DESC');
    expect(cap.url).toContain('pageSize=10');
  });

  it('getErrorGroup fetches both group stats and events for the groupId', async () => {
    const urls: string[] = [];
    const client = makeGcpClientForTest(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any;
    });
    const out: any = await client.getErrorGroup('tok', 'acme-prod', { groupId: 'grp/abc', window: '1d' });
    expect(urls.some((u) => u.includes('/groupStats') && u.includes('groupId=grp%2Fabc'))).toBe(true);
    expect(urls.some((u) => u.includes('/events') && u.includes('groupId=grp%2Fabc'))).toBe(true);
    expect(out).toHaveProperty('stats');
    expect(out).toHaveProperty('events');
  });

  it('windowToPeriod maps relative windows to the nearest Error Reporting period', () => {
    expect(windowToPeriod('30m')).toBe('PERIOD_1_HOUR');
    expect(windowToPeriod('1h')).toBe('PERIOD_1_HOUR');
    expect(windowToPeriod('3h')).toBe('PERIOD_6_HOURS');
    expect(windowToPeriod('1d')).toBe('PERIOD_1_DAY');
    expect(windowToPeriod('7d')).toBe('PERIOD_1_WEEK');
    expect(windowToPeriod('30d')).toBe('PERIOD_30_DAYS');
    expect(windowToPeriod(undefined)).toBe('PERIOD_1_DAY');
  });

  it('reportErrorEvent POSTs a ReportedErrorEvent to events:report', async () => {
    const cap: any = {};
    const client = makeGcpClientForTest((url: string, init?: any) => {
      cap.url = url;
      cap.method = init?.method;
      cap.body = init?.body ? JSON.parse(init.body) : undefined;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as any);
    });
    await client.reportErrorEvent('tok', 'acme-prod', {
      eventTime: '2026-06-16T00:00:00.000Z',
      serviceContext: { service: 'super-error-generator' },
      message: '[TEST] Error: boom\n    at f (a.ts:1:1)\n    at g (b.ts:2:2)',
    });
    expect(cap.url).toBe('https://clouderrorreporting.googleapis.com/v1beta1/projects/acme-prod/events:report');
    expect(cap.method).toBe('POST');
    expect(cap.body.serviceContext.service).toBe('super-error-generator');
    expect(cap.body.message).toContain('[TEST] Error: boom');
  });

  it('listProjects maps resource-manager projects to {id,name}', async () => {
    const cap: any = {};
    const projectsFetch = async (url: string, init?: any) => {
      cap.url = url;
      cap.method = init?.method;
      cap.authorization = init?.headers?.Authorization;
      return {
        ok: true, status: 200,
        json: async () => ({ projects: [
          { projectId: 'proj-a', name: 'Proj A' },
          { projectId: 'proj-b', name: 'Proj B' },
        ] }),
        text: async () => '',
      } as any;
    };
    const client = makeGcpClientForTest(projectsFetch);
    const out = await client.listProjects('tok');
    expect(cap.url).toContain('cloudresourcemanager.googleapis.com/v1/projects');
    expect(cap.authorization).toBe('Bearer tok');
    expect(out).toEqual([{ id: 'proj-a', name: 'Proj A' }, { id: 'proj-b', name: 'Proj B' }]);
  });
});
