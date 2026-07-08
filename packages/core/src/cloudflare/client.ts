import { resolveWindow, type Window } from '../gcp/client.js';

type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string>;
}>;

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const API = 'https://api.cloudflare.com/client/v4';

export interface CloudflareClient {
  queryGraphql(headers: Record<string, string>, query: string, variables?: Record<string, unknown>): Promise<unknown>;
  queryWorkerLogs(headers: Record<string, string>, accountId: string, p: Window & { limit?: number; scripts?: string[] }): Promise<unknown>;
  verifyToken(headers: Record<string, string>): Promise<unknown>;
  listAccounts(headers: Record<string, string>): Promise<unknown>;
  listZones(headers: Record<string, string>, accountId?: string): Promise<unknown>;
  listWorkerScripts(headers: Record<string, string>, accountId: string): Promise<unknown>;
}

function makeClient(fetchImpl: FetchImpl): CloudflareClient {
  const call = async (url: string, init: { method: string; headers: Record<string, string>; body?: object }) => {
    const res = await fetchImpl(url, {
      method: init.method,
      headers: { ...init.headers, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return res.json();
  };
  return {
    async queryGraphql(headers, query, variables) {
      return call(GRAPHQL_URL, { method: 'POST', headers, body: { query, variables: variables ?? {} } });
    },
    async queryWorkerLogs(headers, accountId, p) {
      const { start, end } = resolveWindow(p);
      // The telemetry query API wants timeframe.from/to as Unix epoch MILLISECONDS
      // (numbers), and the events view + a parameters object — not ISO strings or a
      // free-text query field.
      const filters = p.scripts && p.scripts.length
        ? [{ key: 'scriptName', operation: 'includes', value: p.scripts }]
        : [];
      return call(`${API}/accounts/${encodeURIComponent(accountId)}/workers/observability/telemetry/query`, {
        method: 'POST', headers,
        body: {
          queryId: 'rca',
          timeframe: { from: Date.parse(start), to: Date.parse(end) },
          view: 'events',
          limit: p.limit ?? 50,
          parameters: { datasets: [], filters, calculations: [] },
        },
      });
    },
    async verifyToken(headers) {
      return call(`${API}/user/tokens/verify`, { method: 'GET', headers });
    },
    async listAccounts(headers) {
      return call(`${API}/accounts?per_page=50`, { method: 'GET', headers });
    },
    async listZones(headers, accountId) {
      const q = accountId ? `?account.id=${encodeURIComponent(accountId)}&per_page=50` : '?per_page=50';
      return call(`${API}/zones${q}`, { method: 'GET', headers });
    },
    async listWorkerScripts(headers, accountId) {
      return call(`${API}/accounts/${encodeURIComponent(accountId)}/workers/scripts`, { method: 'GET', headers });
    },
  };
}

export const realCloudflareClient: CloudflareClient = makeClient(globalThis.fetch as unknown as FetchImpl);
export const makeCloudflareClientForTest = (fetchImpl: FetchImpl): CloudflareClient => makeClient(fetchImpl);
