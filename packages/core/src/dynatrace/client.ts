import { apiBase, dtHeaders, type DynatraceCreds } from './auth.js';

export interface DynatraceWindow { window?: string; start?: string; end?: string; now?: Date }

/** Relative window ('15m','1h','7d') → Dynatrace now-syntax; explicit start/end → ISO. */
export function resolveWindow(w: DynatraceWindow): { from: string; to: string } {
  if (w.start || w.end) {
    const to = w.end ? new Date(w.end) : (w.now ?? new Date());
    const from = w.start ? new Date(w.start) : new Date(to.getTime() - 3_600_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const win = /^\d+[smhd]$/.test(w.window ?? '') ? w.window! : '1h';
  return { from: `now-${win}`, to: 'now' };
}

export interface DynatraceClient {
  validate(creds: DynatraceCreds): Promise<void>;
  queryMetrics(creds: DynatraceCreds, p: DynatraceWindow & { metricSelector: string; entitySelector?: string; resolution?: string }): Promise<unknown>;
  listMetrics(creds: DynatraceCreds, p: { text?: string; metricSelector?: string; pageSize?: number }): Promise<unknown>;
  searchLogs(creds: DynatraceCreds, p: DynatraceWindow & { query: string; limit?: number }): Promise<unknown>;
  aggregateLogs(creds: DynatraceCreds, p: DynatraceWindow & { query: string }): Promise<unknown>;
  listProblems(creds: DynatraceCreds, p: DynatraceWindow & { problemSelector?: string; entitySelector?: string; pageSize?: number }): Promise<unknown>;
  getProblem(creds: DynatraceCreds, p: { problemId: string }): Promise<unknown>;
}

async function dtFetch(creds: DynatraceCreds, path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const q = qs.toString();
  const url = `${apiBase(creds.environmentUrl)}${path}${q ? `?${q}` : ''}`;
  const res = await fetch(url, { method: 'GET', headers: dtHeaders(creds) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Dynatrace GET ${path} → ${res.status} ${text.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

export const realDynatraceClient: DynatraceClient = {
  // validate is tolerant of 403 (valid token, missing metrics.read) — only auth/network errors throw.
  async validate(creds) {
    try { await dtFetch(creds, '/metrics', { pageSize: 1 }); }
    catch (e) { if ((e as { status?: number }).status === 403) return; throw e; }
  },
  async queryMetrics(creds, p) {
    const { from, to } = resolveWindow(p);
    return dtFetch(creds, '/metrics/query', { metricSelector: p.metricSelector, entitySelector: p.entitySelector, resolution: p.resolution, from, to });
  },
  async listMetrics(creds, p) {
    return dtFetch(creds, '/metrics', { text: p.text, metricSelector: p.metricSelector, pageSize: p.pageSize ?? 200 });
  },
  async searchLogs(creds, p) {
    const { from, to } = resolveWindow(p);
    return dtFetch(creds, '/logs/search', { query: p.query, from, to, limit: p.limit ?? 100, sort: '-timestamp' });
  },
  async aggregateLogs(creds, p) {
    const { from, to } = resolveWindow(p);
    return dtFetch(creds, '/logs/aggregate', { query: p.query, from, to });
  },
  async listProblems(creds, p) {
    const { from, to } = resolveWindow(p);
    return dtFetch(creds, '/problems', { problemSelector: p.problemSelector, entitySelector: p.entitySelector, from, to, pageSize: p.pageSize ?? 50 });
  },
  async getProblem(creds, p) {
    return dtFetch(creds, `/problems/${encodeURIComponent(p.problemId)}`);
  },
};

const testDefaults: DynatraceClient = {
  async validate() {},
  async queryMetrics() { return { result: [] }; },
  async listMetrics() { return { metrics: [] }; },
  async searchLogs() { return { results: [] }; },
  async aggregateLogs() { return { result: [] }; },
  async listProblems() { return { problems: [] }; },
  async getProblem() { return { problemId: 'x' }; },
};

export function makeDynatraceClientForTest(overrides?: Partial<DynatraceClient>): DynatraceClient {
  return { ...testDefaults, ...(overrides ?? {}) };
}
