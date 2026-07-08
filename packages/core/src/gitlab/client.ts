import { assertSafeBaseUrl } from '../security/ssrf.js';
import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';
import type { OrgIntegration } from '../store/types.js';

export type GitlabProbeResult = { ok: boolean; status?: number; detail?: string; accountLabel?: string };
export interface CatalogRepoDetail { fullName: string; defaultBranch: string | null; private: boolean; }
export interface GitlabCreds { token: string; baseUrl?: string; }

type FetchImpl = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>;

export interface GitlabClient {
  probe(c: GitlabCreds): Promise<GitlabProbeResult>;
  listReposDetailed(c: GitlabCreds & { page?: number }): Promise<{ repos: CatalogRepoDetail[]; nextPage: number | null }>;
  getFile(c: GitlabCreds, repo: string, path: string, ref: string | null): Promise<{ text: string; sha: string }>;
  listDirectory(c: GitlabCreds, repo: string, path: string, ref: string | null): Promise<Array<{ name: string; path: string; type: string }>>;
  getRefInfo(c: GitlabCreds, repo: string, ref: string | null): Promise<{ ref: string; sha: string }>;
  searchCode(c: GitlabCreds, repo: string, query: string): Promise<Array<{ path: string; url: string }>>;
  searchIssues(c: GitlabCreds, repo: string, query: string): Promise<Array<{ number: number; title: string; state: string }>>;
  getIssue(c: GitlabCreds, repo: string, number: number): Promise<{ number: number; title: string; state: string; body: string }>;
  createIssue(c: GitlabCreds, repo: string, title: string, body: string): Promise<{ number: number; url: string }>;
  listMergeRequests(c: GitlabCreds, repo: string, state: string): Promise<Array<{ number: number; title: string; state: string }>>;
  getMergeRequest(c: GitlabCreds, repo: string, number: number): Promise<{ number: number; title: string; state: string; body: string; diff: string }>;
  listTree(c: GitlabCreds, repo: string, ref: string): Promise<{ truncated: boolean; entries: { path: string; type: string; sha?: string; size?: number }[] }>;
}

/** Cloud → gitlab.com/api/v4; self-managed https://host → https://host/api/v4. */
export function apiBaseFor(baseUrl?: string): string {
  if (!baseUrl) return 'https://gitlab.com/api/v4';
  return `${assertSafeBaseUrl(baseUrl).origin}/api/v4`;
}

function webBaseFor(baseUrl?: string): string {
  return baseUrl ? assertSafeBaseUrl(baseUrl).origin : 'https://gitlab.com';
}

const GL_HEADERS = (token: string) => ({ 'private-token': token, accept: 'application/json', 'user-agent': 'intellilabs-agent' });
const pid = (repo: string) => encodeURIComponent(repo);
const fp = (path: string) => encodeURIComponent(path);
// GitLab requires a ref for file/tree reads; the tool layer resolves it from the project repo's
// default branch. 'HEAD' is the last-resort fallback when nothing was configured.
const refOr = (ref: string | null) => ref ?? 'HEAD';

function makeClient(fetchImpl: FetchImpl): GitlabClient {
  const get = (c: GitlabCreds, pathAndQuery: string) =>
    fetchImpl(`${apiBaseFor(c.baseUrl)}${pathAndQuery}`, { method: 'GET', headers: GL_HEADERS(c.token) });

  return {
    async probe(c) {
      try {
        const res = await get(c, '/user');
        if (!res.ok) return { ok: false, status: res.status, detail: `gitlab returned ${res.status}` };
        const u = await res.json();
        return { ok: true, status: res.status, accountLabel: u.username };
      } catch { return { ok: false, detail: "couldn't reach gitlab" }; }
    },
    async listReposDetailed(c) {
      const page = c.page ?? 1;
      const res = await get(c, `/projects?membership=true&per_page=100&page=${page}&order_by=path&sort=asc`);
      if (!res.ok) return { repos: [], nextPage: null };
      const arr = ((await res.json()) ?? []) as any[];
      const repos = arr.map((r): CatalogRepoDetail => ({
        fullName: r.path_with_namespace, defaultBranch: r.default_branch ?? null, private: r.visibility !== 'public',
      }));
      return { repos, nextPage: repos.length >= 100 ? page + 1 : null };
    },
    async getFile(c, repo, path, ref) {
      const res = await get(c, `/projects/${pid(repo)}/repository/files/${fp(path)}?ref=${encodeURIComponent(refOr(ref))}`);
      if (!res.ok) throw new Error(`gitlab get_file ${res.status}`);
      const b = await res.json();
      const text = b.encoding === 'base64' ? Buffer.from(b.content, 'base64').toString('utf8') : String(b.content ?? '');
      return { text, sha: b.blob_id ?? b.last_commit_id ?? '' };
    },
    async listDirectory(c, repo, path, ref) {
      const res = await get(c, `/projects/${pid(repo)}/repository/tree?path=${fp(path)}&ref=${encodeURIComponent(refOr(ref))}&per_page=100`);
      if (!res.ok) throw new Error(`gitlab list_directory ${res.status}`);
      const arr = (await res.json()) as any[];
      return (Array.isArray(arr) ? arr : []).map((e) => ({ name: e.name, path: e.path, type: e.type === 'tree' ? 'dir' : 'file' }));
    },
    async getRefInfo(c, repo, ref) {
      const r = refOr(ref);
      const res = await get(c, `/projects/${pid(repo)}/repository/commits/${encodeURIComponent(r)}`);
      if (!res.ok) throw new Error(`gitlab get_ref_info ${res.status}`);
      return { ref: r, sha: (await res.json()).id };
    },
    async searchCode(c, repo, query) {
      const res = await get(c, `/projects/${pid(repo)}/search?scope=blobs&search=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`gitlab search_code ${res.status}`);
      const web = webBaseFor(c.baseUrl);
      return ((await res.json()) ?? []).map((i: any) => ({ path: i.path, url: `${web}/${repo}/-/blob/${i.ref}/${i.path}` }));
    },
    async searchIssues(c, repo, query) {
      const res = await get(c, `/projects/${pid(repo)}/search?scope=issues&search=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`gitlab search_issues ${res.status}`);
      return ((await res.json()) ?? []).map((i: any) => ({ number: i.iid, title: i.title, state: i.state }));
    },
    async getIssue(c, repo, number) {
      const res = await get(c, `/projects/${pid(repo)}/issues/${number}`);
      if (!res.ok) throw new Error(`gitlab get_issue ${res.status}`);
      const b = await res.json();
      return { number: b.iid, title: b.title, state: b.state, body: b.description ?? '' };
    },
    async createIssue(c, repo, title, body) {
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/projects/${pid(repo)}/issues`, {
        method: 'POST', headers: { ...GL_HEADERS(c.token), 'content-type': 'application/json' }, body: JSON.stringify({ title, description: body }),
      });
      if (!res.ok) throw new Error(`gitlab create_issue ${res.status}`);
      const b = await res.json();
      return { number: b.iid, url: b.web_url };
    },
    async listMergeRequests(c, repo, state) {
      const glState = state === 'open' ? 'opened' : state === 'closed' ? 'closed' : state === 'merged' ? 'merged' : 'all';
      const res = await get(c, `/projects/${pid(repo)}/merge_requests?state=${glState}&per_page=30`);
      if (!res.ok) throw new Error(`gitlab list_merge_requests ${res.status}`);
      return ((await res.json()) ?? []).map((m: any) => ({ number: m.iid, title: m.title, state: m.state }));
    },
    async getMergeRequest(c, repo, number) {
      const res = await get(c, `/projects/${pid(repo)}/merge_requests/${number}/changes`);
      if (!res.ok) throw new Error(`gitlab get_merge_request ${res.status}`);
      const b = await res.json();
      const diff = ((b.changes ?? []) as any[]).map((ch) => ch.diff).join('\n');
      return { number: b.iid, title: b.title, state: b.state, body: b.description ?? '', diff };
    },
    async listTree(c, repo, ref) {
      const r = refOr(ref);
      const entries: { path: string; type: string; sha?: string; size?: number }[] = [];
      // GitLab paginates trees; the fetch seam exposes no headers, so page by length, capped.
      for (let page = 1; page <= 50; page++) {
        const res = await get(c, `/projects/${pid(repo)}/repository/tree?recursive=true&ref=${encodeURIComponent(r)}&per_page=100&page=${page}`);
        if (!res.ok) throw new Error(`gitlab list_tree ${res.status}`);
        const arr = ((await res.json()) ?? []) as any[];
        for (const e of arr) entries.push({ path: e.path, type: e.type, sha: e.id });
        if (arr.length < 100) return { truncated: false, entries };
      }
      return { truncated: true, entries };
    },
  };
}

export const realGitlabClient: GitlabClient = makeClient(globalThis.fetch as unknown as FetchImpl);
export const makeGitlabClientForTest = (fetchImpl: FetchImpl): GitlabClient => makeClient(fetchImpl);

/** Resolve GitLab credentials from an OrgIntegration row + runtime config.
 *  Single source of truth shared by server tools, routes/gitlab.ts and catalog sync. */
export function gitlabCredsForRow(row: OrgIntegration, cfg: { SECRETS_KEY?: string }): GitlabCreds {
  return { token: decryptSecret(row.secretCiphertext!, keyFromBase64(cfg.SECRETS_KEY!)), baseUrl: row.baseUrl ?? undefined };
}
