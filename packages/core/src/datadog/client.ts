import { siteBaseUrl, ddHeaders } from './auth.js';
import type { DatadogCreds } from './auth.js';

export interface DatadogWindow { window?: string; start?: string; end?: string; now?: Date }

const MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Resolve a relative window ('15m','1h','7d') or explicit start/end.
 *  Returns both unix-seconds (for Metrics API) and unix-ms (for Logs/Spans API). */
export function resolveWindow(w: DatadogWindow): { fromSec: number; toSec: number; fromMs: number; toMs: number } {
  const toDate = w.end ? new Date(w.end) : (w.now ?? new Date());
  let fromDate: Date;
  if (w.start) {
    fromDate = new Date(w.start);
  } else {
    const m = /^(\d+)([smhd])$/.exec(w.window ?? '1h');
    const span = m ? Number(m[1]) * MS[m[2] as keyof typeof MS] : MS.h;
    fromDate = new Date(toDate.getTime() - span);
  }
  return {
    fromSec: Math.floor(fromDate.getTime() / 1000),
    toSec: Math.floor(toDate.getTime() / 1000),
    fromMs: fromDate.getTime(),
    toMs: toDate.getTime(),
  };
}

async function ddFetch(creds: DatadogCreds, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${siteBaseUrl(creds.site)}${path}`, {
    method,
    headers: ddHeaders(creds),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Datadog ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

export interface DatadogClient {
  validate(creds: DatadogCreds): Promise<void>;
  queryMetrics(creds: DatadogCreds, p: DatadogWindow & { query: string }): Promise<unknown>;
  listMetrics(creds: DatadogCreds, p: DatadogWindow & { filterTag?: string }): Promise<unknown>;
  searchLogs(creds: DatadogCreds, p: DatadogWindow & { query: string; limit?: number }): Promise<unknown>;
  aggregateLogs(creds: DatadogCreds, p: DatadogWindow & { query: string; groupBy?: string[] }): Promise<unknown>;
  searchSpans(creds: DatadogCreds, p: DatadogWindow & { query: string; limit?: number }): Promise<unknown>;
  aggregateSpans(creds: DatadogCreds, p: DatadogWindow & { query: string; metric?: string; aggregation: string; groupBy?: string[] }): Promise<unknown>;
  listMonitors(creds: DatadogCreds, p: { tags?: string; monitorStates?: string }): Promise<unknown>;
}

export const realDatadogClient: DatadogClient = {
  async validate(creds) {
    await ddFetch(creds, 'GET', '/api/v1/validate');
  },

  async queryMetrics(creds, p) {
    const { fromSec, toSec } = resolveWindow(p);
    const qs = new URLSearchParams({ from: String(fromSec), to: String(toSec), query: p.query });
    return ddFetch(creds, 'GET', `/api/v1/query?${qs}`);
  },

  async listMetrics(creds, p) {
    const qs = p.filterTag ? new URLSearchParams({ 'filter[tags]': p.filterTag }) : null;
    return ddFetch(creds, 'GET', `/api/v2/metrics${qs ? `?${qs}` : ''}`);
  },

  async searchLogs(creds, p) {
    const { fromMs, toMs } = resolveWindow(p);
    return ddFetch(creds, 'POST', '/api/v2/logs/events/search', {
      filter: { query: p.query, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      page: { limit: p.limit ?? 100 },
    });
  },

  async aggregateLogs(creds, p) {
    const { fromMs, toMs } = resolveWindow(p);
    const body: Record<string, unknown> = {
      filter: { query: p.query, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      compute: [{ aggregation: 'count' }],
    };
    if (p.groupBy?.length) body['group_by'] = p.groupBy.map((f) => ({ facet: f }));
    return ddFetch(creds, 'POST', '/api/v2/logs/analytics/aggregate', body);
  },

  async searchSpans(creds, p) {
    const { fromMs, toMs } = resolveWindow(p);
    return ddFetch(creds, 'POST', '/api/v2/spans/events/search', {
      data: {
        attributes: {
          filter: { query: p.query, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
          page: { limit: p.limit ?? 100 },
        },
      },
    });
  },

  async aggregateSpans(creds, p) {
    const { fromMs, toMs } = resolveWindow(p);
    return ddFetch(creds, 'POST', '/api/v2/spans/analytics/aggregate', {
      data: {
        attributes: {
          filter: { query: p.query, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
          compute: [{ aggregation: p.aggregation, metric: p.metric }],
          group_by: p.groupBy?.map((f) => ({ facet: f })) ?? [],
        },
      },
    });
  },

  async listMonitors(creds, p) {
    const qs = new URLSearchParams();
    if (p.tags) qs.set('monitor_tags', p.tags);
    if (p.monitorStates) qs.set('group_states', p.monitorStates);
    const qStr = qs.toString();
    return ddFetch(creds, 'GET', `/api/v1/monitor${qStr ? `?${qStr}` : ''}`);
  },
};

const testDefaults: DatadogClient = {
  async validate() {},
  async queryMetrics() { return {}; },
  async listMetrics() { return { data: [] }; },
  async searchLogs() { return { data: [] }; },
  async aggregateLogs() { return { data: { buckets: [] } }; },
  async searchSpans() { return { data: [] }; },
  async aggregateSpans() { return { data: { buckets: [] } }; },
  async listMonitors() { return []; },
};

export function makeDatadogClientForTest(overrides?: Partial<DatadogClient>): DatadogClient {
  return { ...testDefaults, ...overrides };
}
