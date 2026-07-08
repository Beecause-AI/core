type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string>;
}>;

export interface GrafanaDatasource { uid: string; name: string; type: string }

export interface GrafanaWindow { window?: string; start?: string; end?: string; now?: Date }

const MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Resolve a relative window ('15m','1h','7d') or explicit start/end to epoch ms. */
export function resolveWindow(w: GrafanaWindow): { startMs: number; endMs: number } {
  const end = w.end ? new Date(w.end) : (w.now ?? new Date());
  if (w.start) return { startMs: new Date(w.start).getTime(), endMs: end.getTime() };
  const m = /^(\d+)([smhd])$/.exec(w.window ?? '1h');
  const span = m ? Number(m[1]) * MS[m[2] as keyof typeof MS] : MS.h;
  return { startMs: end.getTime() - span, endMs: end.getTime() };
}

export interface GrafanaClient {
  getOrg(baseUrl: string, headers: Record<string, string>): Promise<{ name?: string }>;
  listDatasources(baseUrl: string, headers: Record<string, string>): Promise<GrafanaDatasource[]>;
  queryMetrics(baseUrl: string, headers: Record<string, string>, uid: string, p: GrafanaWindow & { query: string; step?: string }): Promise<unknown>;
  queryLogs(baseUrl: string, headers: Record<string, string>, uid: string, p: GrafanaWindow & { query: string; limit?: number; direction?: 'forward' | 'backward' }): Promise<unknown>;
  searchTraces(baseUrl: string, headers: Record<string, string>, uid: string, p: GrafanaWindow & { query?: string; limit?: number }): Promise<unknown>;
  getTrace(baseUrl: string, headers: Record<string, string>, uid: string, traceId: string): Promise<unknown>;
}

const enc = encodeURIComponent;
const sec = (ms: number) => Math.floor(ms / 1000);
const ns = (ms: number) => `${ms}000000`; // ms → ns

function makeClient(fetchImpl: FetchImpl): GrafanaClient {
  const call = async (url: string, headers: Record<string, string>) => {
    const res = await fetchImpl(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`Grafana ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return res.json();
  };
  const proxy = (baseUrl: string, uid: string, path: string) =>
    `${baseUrl}/api/datasources/proxy/uid/${enc(uid)}${path}`;

  return {
    getOrg(baseUrl, headers) { return call(`${baseUrl}/api/org`, headers); },
    async listDatasources(baseUrl, headers) {
      const res = await call(`${baseUrl}/api/datasources`, headers);
      const arr: any[] = Array.isArray(res) ? res : [];
      return arr.map((d) => ({ uid: String(d.uid), name: String(d.name), type: String(d.type) }));
    },
    queryMetrics(baseUrl, headers, uid, p) {
      const { startMs, endMs } = resolveWindow(p);
      if (p.step) {
        return call(proxy(baseUrl, uid, `/api/v1/query_range?query=${enc(p.query)}&start=${sec(startMs)}&end=${sec(endMs)}&step=${enc(p.step)}`), headers);
      }
      return call(proxy(baseUrl, uid, `/api/v1/query?query=${enc(p.query)}&time=${sec(endMs)}`), headers);
    },
    queryLogs(baseUrl, headers, uid, p) {
      const { startMs, endMs } = resolveWindow(p);
      return call(proxy(baseUrl, uid, `/loki/api/v1/query_range?query=${enc(p.query)}&start=${ns(startMs)}&end=${ns(endMs)}&limit=${p.limit ?? 100}&direction=${p.direction ?? 'backward'}`), headers);
    },
    searchTraces(baseUrl, headers, uid, p) {
      const { startMs, endMs } = resolveWindow(p);
      const q = p.query ? `q=${enc(p.query)}&` : '';
      return call(proxy(baseUrl, uid, `/api/search?${q}start=${sec(startMs)}&end=${sec(endMs)}&limit=${p.limit ?? 20}`), headers);
    },
    getTrace(baseUrl, headers, uid, traceId) {
      return call(proxy(baseUrl, uid, `/api/traces/${enc(traceId)}`), headers);
    },
  };
}

export const realGrafanaClient: GrafanaClient = makeClient(globalThis.fetch as unknown as FetchImpl);
export const makeGrafanaClientForTest = (fetchImpl: FetchImpl): GrafanaClient => makeClient(fetchImpl);
