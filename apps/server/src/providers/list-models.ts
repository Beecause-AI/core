import { endpoint } from './probe.js';

type FetchImpl = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
export type ListModelsResult = { ok: boolean; ids: string[]; status?: number; detail?: string };
export type ListModelsOpts = { baseUrl?: string; fetchImpl?: FetchImpl };

function parseIds(provider: string, body: any): string[] {
  if (provider === 'google') {
    const models = Array.isArray(body?.models) ? body.models : [];
    return models.map((m: any) => String(m?.name ?? '').replace(/^models\//, '')).filter(Boolean);
  }
  const data = Array.isArray(body?.data) ? body.data : [];
  return data.map((m: any) => String(m?.id ?? '')).filter(Boolean);
}

function detailForStatus(status: number): string {
  if (status === 401 || status === 403) return 'The API key was rejected as invalid or unauthorized.';
  if (status === 429) return 'The provider rate-limited the request — try again shortly.';
  if (status >= 500) return 'The provider had a server error — try again shortly.';
  return `The provider rejected the request (HTTP ${status}).`;
}

/** Fetch and parse a provider's model-list endpoint. Returns clean ids, never raw bodies. */
export async function listProviderModels(provider: string, key: string, opts: ListModelsOpts = {}): Promise<ListModelsResult> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  let ep: { url: string; headers: Record<string, string> };
  try { ep = endpoint(provider, key, opts.baseUrl); }
  catch (e) { return { ok: false, ids: [], detail: (e as Error).message }; }
  try {
    const res = await doFetch(ep.url, { method: 'GET', headers: ep.headers });
    if (!res.ok) return { ok: false, ids: [], status: res.status, detail: detailForStatus(res.status) };
    const body = await res.json().catch(() => ({}));
    return { ok: true, ids: parseIds(provider, body), status: res.status };
  } catch {
    return { ok: false, ids: [], detail: "couldn't reach provider" };
  }
}
