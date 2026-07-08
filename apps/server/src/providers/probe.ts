import { assertSafeBaseUrl } from '../security/ssrf.js';
export { assertSafeBaseUrl };

export type ProbeResult = { ok: boolean; status?: number; detail?: string };
type FetchImpl = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
export type ProbeOpts = { baseUrl?: string; fetchImpl?: FetchImpl };

const ANTHROPIC_VERSION = '2023-06-01';

export function endpoint(provider: string, key: string, baseUrl?: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: { authorization: `Bearer ${key}` } };
    case 'google':
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': key } };
    case 'openai-compatible': {
      const base = assertSafeBaseUrl(baseUrl ?? '').toString().replace(/\/$/, '');
      return { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } };
    }
    default:
      throw new Error(`unknown provider: ${provider}`);
  }
}

/** Validate a provider API key with a cheap auth-checked GET to its models endpoint. */
export async function probeProvider(provider: string, key: string, opts: ProbeOpts = {}): Promise<ProbeResult> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  let ep: { url: string; headers: Record<string, string> };
  try { ep = endpoint(provider, key, opts.baseUrl); }
  catch (e) { return { ok: false, detail: (e as Error).message }; }
  try {
    const res = await doFetch(ep.url, { method: 'GET', headers: ep.headers });
    if (res.ok) return { ok: true, status: res.status };
    // Map the status to a clean operator-facing message. The provider's raw
    // body often carries internal shapes / request_ids and reads as a leaked
    // JSON blob in the UI — never surface it verbatim.
    return { ok: false, status: res.status, detail: detailForStatus(res.status) };
  } catch {
    return { ok: false, detail: "couldn't reach provider" };
  }
}

function detailForStatus(status: number): string {
  if (status === 401 || status === 403) return 'The API key was rejected as invalid or unauthorized.';
  if (status === 429) return 'The provider rate-limited the check — try again shortly.';
  if (status >= 500) return 'The provider had a server error — try again shortly.';
  return `The provider rejected the request (HTTP ${status}).`;
}
