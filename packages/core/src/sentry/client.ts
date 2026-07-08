type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string>;
}>;

export interface SentryListIssuesOpts {
  query?: string;
  statsPeriod?: string;
  sort?: string;
  limit?: number;
}

export interface SentryClient {
  /** Verify a token + org slug (used by the connection test). */
  getOrganization(baseUrl: string, headers: Record<string, string>, orgSlug: string): Promise<unknown>;
  /** Discovery: the org's Sentry projects (powers the scope picker). */
  listProjects(baseUrl: string, headers: Record<string, string>, orgSlug: string): Promise<unknown>;
  listIssues(baseUrl: string, headers: Record<string, string>, orgSlug: string, projectSlug: string, opts?: SentryListIssuesOpts): Promise<unknown>;
  getIssue(baseUrl: string, headers: Record<string, string>, orgSlug: string, issueId: string): Promise<unknown>;
  getLatestEvent(baseUrl: string, headers: Record<string, string>, orgSlug: string, issueId: string): Promise<unknown>;
}

const trim = (baseUrl: string) => baseUrl.replace(/\/+$/, '');
const enc = encodeURIComponent;

function makeClient(fetchImpl: FetchImpl): SentryClient {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetchImpl(url, { method: 'GET', headers: { ...headers, 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Sentry ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return res.json();
  };
  return {
    async getOrganization(baseUrl, headers, orgSlug) {
      return get(`${trim(baseUrl)}/api/0/organizations/${enc(orgSlug)}/`, headers);
    },
    async listProjects(baseUrl, headers, orgSlug) {
      return get(`${trim(baseUrl)}/api/0/organizations/${enc(orgSlug)}/projects/`, headers);
    },
    async listIssues(baseUrl, headers, orgSlug, projectSlug, opts) {
      const qs = new URLSearchParams();
      if (opts?.query !== undefined) qs.set('query', opts.query);
      qs.set('statsPeriod', opts?.statsPeriod || '24h');
      if (opts?.sort) qs.set('sort', opts.sort);
      qs.set('limit', String(opts?.limit ?? 25));
      return get(`${trim(baseUrl)}/api/0/projects/${enc(orgSlug)}/${enc(projectSlug)}/issues/?${qs.toString()}`, headers);
    },
    async getIssue(baseUrl, headers, orgSlug, issueId) {
      return get(`${trim(baseUrl)}/api/0/organizations/${enc(orgSlug)}/issues/${enc(issueId)}/`, headers);
    },
    async getLatestEvent(baseUrl, headers, orgSlug, issueId) {
      return get(`${trim(baseUrl)}/api/0/organizations/${enc(orgSlug)}/issues/${enc(issueId)}/events/latest/`, headers);
    },
  };
}

export const realSentryClient: SentryClient = makeClient(globalThis.fetch as unknown as FetchImpl);
export const makeSentryClientForTest = (fetchImpl: FetchImpl): SentryClient => makeClient(fetchImpl);
