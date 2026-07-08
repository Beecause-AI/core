import { describe, expect, it } from 'vitest';
import { makeGrafanaClientForTest, discoverGrafanaDatasources, grafanaSignalForType } from '../src/index.js';

function recordingFetch(body: unknown) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  return { impl, calls };
}

const headers = { Authorization: 'Bearer t' };
const now = new Date('2026-06-25T12:00:00.000Z');

describe('grafana client proxy URLs', () => {
  it('builds a Prometheus instant query through the datasource proxy', async () => {
    const { impl, calls } = recordingFetch({ status: 'success' });
    const client = makeGrafanaClientForTest(impl);
    await client.queryMetrics('https://g.io', headers, 'ds1', { query: 'up', window: '1h', now });
    expect(calls[0]).toContain('/api/datasources/proxy/uid/ds1/api/v1/query?query=up&time=');
  });

  it('uses query_range with step + epoch-second bounds', async () => {
    const { impl, calls } = recordingFetch({});
    const client = makeGrafanaClientForTest(impl);
    await client.queryMetrics('https://g.io', headers, 'ds1', { query: 'up', step: '60s', window: '1h', now });
    expect(calls[0]).toContain('/api/v1/query_range?query=up&start=');
    expect(calls[0]).toContain('&step=60s');
  });

  it('queries Loki with nanosecond bounds', async () => {
    const { impl, calls } = recordingFetch({});
    const client = makeGrafanaClientForTest(impl);
    await client.queryLogs('https://g.io', headers, 'logs1', { query: '{app="api"}', window: '15m', now });
    expect(calls[0]).toContain('/api/datasources/proxy/uid/logs1/loki/api/v1/query_range?query=');
    expect(calls[0]).toContain(`&end=${now.getTime()}000000`);
  });

  it('fetches a trace by id', async () => {
    const { impl, calls } = recordingFetch({});
    const client = makeGrafanaClientForTest(impl);
    await client.getTrace('https://g.io', headers, 'traces1', 'abc123');
    expect(calls[0]).toBe('https://g.io/api/datasources/proxy/uid/traces1/api/traces/abc123');
  });

  it('throws on a non-2xx response', async () => {
    const impl = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' });
    const client = makeGrafanaClientForTest(impl);
    await expect(client.getOrg('https://g.io', headers)).rejects.toThrow(/Grafana 403/);
  });
});

describe('grafana discovery → signals', () => {
  it('maps datasource types to signals and drops unsupported types', async () => {
    const impl = async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => [
        { uid: 'p1', name: 'Prom', type: 'prometheus' },
        { uid: 'l1', name: 'Loki', type: 'loki' },
        { uid: 't1', name: 'Tempo', type: 'tempo' },
        { uid: 'x1', name: 'Mysql', type: 'mysql' },
      ],
    });
    const client = makeGrafanaClientForTest(impl);
    const { datasources, availableSignals } = await discoverGrafanaDatasources(client, 'https://g.io', headers);
    expect(datasources.map((d) => d.uid)).toEqual(['p1', 'l1', 't1']);
    expect(new Set(availableSignals)).toEqual(new Set(['metrics', 'logs', 'traces']));
  });

  it('signalForType maps the known types', () => {
    expect(grafanaSignalForType('prometheus')).toBe('metrics');
    expect(grafanaSignalForType('loki')).toBe('logs');
    expect(grafanaSignalForType('tempo')).toBe('traces');
    expect(grafanaSignalForType('mysql')).toBeUndefined();
  });
});
