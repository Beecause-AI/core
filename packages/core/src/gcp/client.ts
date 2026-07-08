type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string>;
}>;

export interface Window { window?: string; start?: string; end?: string; now?: Date; }

export interface ReportedErrorEvent {
  message: string;                              // exception + stack-trace string (drives grouping)
  eventTime?: string;                           // ISO timestamp
  serviceContext?: { service: string; version?: string };
}

const MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Resolve a relative window ('15m','1h','7d') or explicit start/end to ISO strings. */
export function resolveWindow(w: Window): { start: string; end: string } {
  const end = w.end ? new Date(w.end) : (w.now ?? new Date());
  if (w.start) return { start: new Date(w.start).toISOString(), end: end.toISOString() };
  const m = /^(\d+)([smhd])$/.exec(w.window ?? '1h');
  const span = m ? Number(m[1]) * MS[m[2] as keyof typeof MS] : MS.h;
  return { start: new Date(end.getTime() - span).toISOString(), end: end.toISOString() };
}

/** Map a relative window to the nearest Error Reporting timeRange.period enum.
 *  The Error Reporting API only accepts coarse period buckets, not start/end. */
export function windowToPeriod(window?: string): string {
  const m = /^(\d+)([smhd])$/.exec(window ?? '');
  const span = m ? Number(m[1]) * MS[m[2] as keyof typeof MS] : MS.d;
  if (span <= MS.h) return 'PERIOD_1_HOUR';
  if (span <= 6 * MS.h) return 'PERIOD_6_HOURS';
  if (span <= MS.d) return 'PERIOD_1_DAY';
  if (span <= 7 * MS.d) return 'PERIOD_1_WEEK';
  return 'PERIOD_30_DAYS';
}

export interface GcpClient {
  queryMetrics(token: string, project: string, p: Window & { query: string; step?: string }): Promise<unknown>;
  queryLogs(token: string, project: string, p: Window & { filter: string; limit?: number; order?: 'asc' | 'desc' }): Promise<unknown>;
  listTraces(token: string, project: string, p: Window & { filter?: string; limit?: number }): Promise<unknown>;
  getTrace(token: string, project: string, traceId: string): Promise<unknown>;
  listMetricDescriptors(token: string, project: string, p: { prefix?: string }): Promise<unknown>;
  listErrorGroups(token: string, project: string, p: Window & { limit?: number }): Promise<unknown>;
  getErrorGroup(token: string, project: string, p: Window & { groupId: string; limit?: number }): Promise<unknown>;
  reportErrorEvent(token: string, project: string, event: ReportedErrorEvent): Promise<unknown>;
  listProjects(token: string): Promise<{ id: string; name: string }[]>;
}

function makeClient(fetchImpl: FetchImpl): GcpClient {
  const call = async (url: string, init: { method: string; token: string; body?: object }) => {
    const res = await fetchImpl(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) throw new Error(`GCP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return res.json();
  };

  return {
    async queryMetrics(token, project, p) {
      const { start, end } = resolveWindow(p);
      const base = `https://monitoring.googleapis.com/v1/projects/${project}/location/global/prometheus/api/v1`;
      if (p.step) {
        const u = `${base}/query_range?query=${encodeURIComponent(p.query)}&start=${start}&end=${end}&step=${encodeURIComponent(p.step)}`;
        return call(u, { method: 'POST', token });
      }
      return call(`${base}/query?query=${encodeURIComponent(p.query)}&time=${end}`, { method: 'POST', token });
    },
    async queryLogs(token, project, p) {
      const { start, end } = resolveWindow(p);
      const filter = `(${p.filter}) AND timestamp>="${start}" AND timestamp<="${end}"`;
      return call('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST', token,
        body: { resourceNames: [`projects/${project}`], filter, orderBy: `timestamp ${p.order ?? 'desc'}`, pageSize: p.limit ?? 50 },
      });
    },
    async listTraces(token, project, p) {
      const { start, end } = resolveWindow(p);
      const params = new URLSearchParams({ startTime: start, endTime: end, pageSize: String(p.limit ?? 50) });
      if (p.filter) params.set('filter', p.filter);
      return call(`https://cloudtrace.googleapis.com/v1/projects/${project}/traces?${params}`, { method: 'GET', token });
    },
    async getTrace(token, project, traceId) {
      return call(`https://cloudtrace.googleapis.com/v1/projects/${project}/traces/${encodeURIComponent(traceId)}`, { method: 'GET', token });
    },
    async listMetricDescriptors(token, project, p) {
      const params = new URLSearchParams({ pageSize: '200' });
      if (p.prefix) params.set('filter', `metric.type = starts_with("${p.prefix}")`);
      return call(`https://monitoring.googleapis.com/v3/projects/${project}/metricDescriptors?${params}`, { method: 'GET', token });
    },
    async listErrorGroups(token, project, p) {
      const params = new URLSearchParams({ 'timeRange.period': windowToPeriod(p.window), order: 'COUNT_DESC', pageSize: String(p.limit ?? 20) });
      return call(`https://clouderrorreporting.googleapis.com/v1beta1/projects/${project}/groupStats?${params}`, { method: 'GET', token });
    },
    async getErrorGroup(token, project, p) {
      const period = windowToPeriod(p.window);
      const base = `https://clouderrorreporting.googleapis.com/v1beta1/projects/${project}`;
      const gid = encodeURIComponent(p.groupId);
      const [stats, events] = await Promise.all([
        call(`${base}/groupStats?groupId=${gid}&timeRange.period=${period}`, { method: 'GET', token }),
        call(`${base}/events?groupId=${gid}&timeRange.period=${period}&pageSize=${p.limit ?? 10}`, { method: 'GET', token }),
      ]);
      return { stats, events };
    },
    async reportErrorEvent(token, project, event) {
      return call(`https://clouderrorreporting.googleapis.com/v1beta1/projects/${project}/events:report`, {
        method: 'POST', token, body: event,
      });
    },
    async listProjects(token) {
      const res = await call('https://cloudresourcemanager.googleapis.com/v1/projects', { method: 'GET', token });
      const projects: any[] = (res as any)?.projects ?? [];
      return projects.map((p) => ({ id: p.projectId, name: p.name }));
    },
  };
}

export const realGcpClient: GcpClient = makeClient(globalThis.fetch as unknown as FetchImpl);
export const makeGcpClientForTest = (fetchImpl: FetchImpl): GcpClient => makeClient(fetchImpl);
