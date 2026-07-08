import { createSign } from 'node:crypto';
import { assertSafeBaseUrl } from '../security/ssrf.js';
import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';
import type { OrgIntegration } from '../db/schema.js';
import type { IntegrationMetadata } from '../repos/org-integrations.js';

export type GithubProbeResult = { ok: boolean; status?: number; detail?: string; accountLabel?: string };

export interface CatalogRepoDetail { fullName: string; defaultBranch: string | null; private: boolean; }

type FetchImpl = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>;

export interface AppCreds { appId: string; privateKey: string; installationId: string; baseUrl?: string; }
export interface PatCreds { token: string; baseUrl?: string; }
export type Creds = { mode: 'pat' | 'agent_app' | 'custom_app' } & Partial<AppCreds> & Partial<PatCreds>;

export interface GithubClient {
  probePat(c: PatCreds): Promise<GithubProbeResult>;
  probeApp(c: AppCreds): Promise<GithubProbeResult>;
  listRepos(c: { mode: 'pat' | 'agent_app' | 'custom_app' } & Partial<AppCreds> & Partial<PatCreds>): Promise<string[]>;
  listReposDetailed(c: { mode: 'pat' | 'agent_app' | 'custom_app'; page?: number } & Partial<AppCreds> & Partial<PatCreds>): Promise<{ repos: CatalogRepoDetail[]; nextPage: number | null }>;
  installationAccount(c: AppCreds): Promise<string | null>;
  getFile(c: Creds, repo: string, path: string, ref: string | null): Promise<{ text: string; sha: string }>;
  listDirectory(c: Creds, repo: string, path: string, ref: string | null): Promise<Array<{ name: string; path: string; type: string }>>;
  getRefInfo(c: Creds, repo: string, ref: string | null): Promise<{ ref: string; sha: string }>;
  searchCode(c: Creds, repo: string, query: string): Promise<Array<{ path: string; url: string }>>;
  searchIssues(c: Creds, repo: string, query: string): Promise<Array<{ number: number; title: string; state: string }>>;
  getIssue(c: Creds, repo: string, number: number): Promise<{ number: number; title: string; state: string; body: string }>;
  createIssue(c: Creds, repo: string, title: string, body: string): Promise<{ number: number; url: string; nodeId: string }>;
  listPullRequests(c: Creds, repo: string, state: string): Promise<Array<{ number: number; title: string; state: string }>>;
  getPullRequest(c: Creds, repo: string, number: number): Promise<{ number: number; title: string; state: string; body: string; diff: string }>;
  listCommits(c: Creds, repo: string, opts: { path?: string; since?: string; until?: string; sha?: string; perPage?: number }): Promise<Array<{ sha: string; shortSha: string; message: string; author: string; date: string; url: string }>>;
  getCommit(c: Creds, repo: string, sha: string): Promise<{ sha: string; message: string; author: string; date: string; url: string; stats: { additions: number; deletions: number; total: number }; files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }> }>;
  listTree(c: Creds, repo: string, ref: string): Promise<{ truncated: boolean; entries: { path: string; type: string; sha: string; size?: number }[] }>;
}

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Cloud → api.github.com; GHES baseUrl https://host → https://host/api/v3. */
export function apiBaseFor(baseUrl?: string): string {
  if (!baseUrl) return 'https://api.github.com';
  const u = assertSafeBaseUrl(baseUrl);
  return `${u.origin}/api/v3`;
}

/** Cloud → api.github.com/graphql; GHES baseUrl https://host → https://host/api/graphql. */
export function graphqlUrlFor(baseUrl?: string): string {
  if (!baseUrl) return 'https://api.github.com/graphql';
  return `${assertSafeBaseUrl(baseUrl).origin}/api/graphql`;
}

/** App-authentication JWT (RS256), valid ~9 min, signed with the App private key. */
export function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const data = `${header}.${payload}`;
  const sig = createSign('RSA-SHA256').update(data).end().sign(privateKeyPem);
  return `${data}.${b64url(sig)}`;
}

const GH_HEADERS = (auth: string) => ({
  authorization: auth, accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28', 'user-agent': 'intellilabs-agent',
});

/** Maximum combined character count returned for diffs and per-file patches, to
 *  prevent huge repository changes from flooding agent context windows. */
const MAX_DIFF_CHARS = 50_000;

function makeClient(fetchImpl: FetchImpl): GithubClient {
  async function mintInstallationToken(c: AppCreds): Promise<string> {
    const base = apiBaseFor(c.baseUrl);
    const jwt = appJwt(c.appId, c.privateKey);
    const res = await fetchImpl(`${base}/app/installations/${c.installationId}/access_tokens`, {
      method: 'POST', headers: GH_HEADERS(`Bearer ${jwt}`),
    });
    if (!res.ok) throw new Error(`installation token failed: ${res.status}`);
    const body = await res.json();
    return body.token as string;
  }

  async function tokenFor(c: Creds): Promise<{ scheme: 'Bearer' | 'token'; token: string }> {
    if (c.mode === 'pat') return { scheme: 'Bearer', token: c.token! };
    const token = await mintInstallationToken({ appId: c.appId!, privateKey: c.privateKey!, installationId: c.installationId!, baseUrl: c.baseUrl });
    return { scheme: 'token', token };
  }
  const refQuery = (ref: string | null) => (ref ? `?ref=${encodeURIComponent(ref)}` : '');

  async function fetchContents(c: Creds, repo: string, path: string, ref: string | null) {
    const { scheme, token } = await tokenFor(c);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/contents/${encoded}${refQuery(ref)}`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
  }

  async function installationAccount(c: AppCreds): Promise<string | null> {
    const jwt = appJwt(c.appId, c.privateKey);
    const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/app/installations/${c.installationId}`, { method: 'GET', headers: GH_HEADERS(`Bearer ${jwt}`) });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.account?.login ?? null;
  }

  return {
    async probePat(c) {
      try {
        const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/user`, { method: 'GET', headers: GH_HEADERS(`Bearer ${c.token}`) });
        if (!res.ok) return { ok: false, status: res.status, detail: `github returned ${res.status}` };
        const u = await res.json();
        return { ok: true, status: res.status, accountLabel: u.login };
      } catch { return { ok: false, detail: "couldn't reach github" }; }
    },
    async probeApp(c) {
      try {
        await mintInstallationToken(c);
        const account = await installationAccount(c);
        return { ok: true, accountLabel: account ?? undefined };
      } catch (e) { return { ok: false, detail: (e as Error).message }; }
    },
    installationAccount,
    async listRepos(c) {
      if (c.mode === 'pat') {
        const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/user/repos?per_page=100&sort=updated`, { method: 'GET', headers: GH_HEADERS(`Bearer ${c.token}`) });
        if (!res.ok) return [];
        return (await res.json()).map((r: any) => r.full_name);
      }
      const token = await mintInstallationToken({ appId: c.appId!, privateKey: c.privateKey!, installationId: c.installationId!, baseUrl: c.baseUrl });
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/installation/repositories?per_page=100`, { method: 'GET', headers: GH_HEADERS(`token ${token}`) });
      if (!res.ok) return [];
      return ((await res.json()).repositories ?? []).map((r: any) => r.full_name);
    },
    async listReposDetailed(c) {
      const page = c.page ?? 1;
      const map = (r: any): CatalogRepoDetail => ({ fullName: r.full_name, defaultBranch: r.default_branch ?? null, private: !!r.private });
      const done = (repos: CatalogRepoDetail[]) => ({ repos, nextPage: repos.length >= 100 ? page + 1 : null });
      if (c.mode === 'pat') {
        const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/user/repos?per_page=100&page=${page}`, { method: 'GET', headers: GH_HEADERS(`Bearer ${c.token}`) });
        if (!res.ok) return { repos: [], nextPage: null };
        return done((((await res.json()) ?? []) as any[]).map(map));
      }
      const token = await mintInstallationToken({ appId: c.appId!, privateKey: c.privateKey!, installationId: c.installationId!, baseUrl: c.baseUrl });
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/installation/repositories?per_page=100&page=${page}`, { method: 'GET', headers: GH_HEADERS(`token ${token}`) });
      if (!res.ok) return { repos: [], nextPage: null };
      return done(((((await res.json()).repositories ?? []) as any[])).map(map));
    },
    async getFile(c, repo, path, ref) {
      const res = await fetchContents(c, repo, path, ref);
      if (!res.ok) throw new Error(`github get_file ${res.status}`);
      const body = await res.json();
      const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : String(body.content ?? '');
      return { text, sha: body.sha };
    },
    async listDirectory(c, repo, path, ref) {
      const res = await fetchContents(c, repo, path, ref);
      if (!res.ok) throw new Error(`github list_directory ${res.status}`);
      const body = await res.json();
      return (Array.isArray(body) ? body : []).map((e: any) => ({ name: e.name, path: e.path, type: e.type }));
    },
    async getRefInfo(c, repo, ref) {
      const { scheme, token } = await tokenFor(c);
      const r = ref ?? 'HEAD';
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/commits/${encodeURIComponent(r)}`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github get_ref_info ${res.status}`);
      const body = await res.json();
      return { ref: r, sha: body.sha };
    },
    async searchCode(c, repo, query) {
      const { scheme, token } = await tokenFor(c);
      const q = encodeURIComponent(`${query} repo:${repo}`);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/search/code?q=${q}&per_page=30`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github search_code ${res.status}`);
      return ((await res.json()).items ?? []).map((i: any) => ({ path: i.path, url: i.html_url }));
    },
    async searchIssues(c, repo, query) {
      const { scheme, token } = await tokenFor(c);
      const q = encodeURIComponent(`${query} repo:${repo} type:issue`);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/search/issues?q=${q}&per_page=30`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github search_issues ${res.status}`);
      return ((await res.json()).items ?? []).map((i: any) => ({ number: i.number, title: i.title, state: i.state }));
    },
    async getIssue(c, repo, number) {
      const { scheme, token } = await tokenFor(c);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/issues/${number}`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github get_issue ${res.status}`);
      const b = await res.json();
      return { number: b.number, title: b.title, state: b.state, body: b.body ?? '' };
    },
    async createIssue(c, repo, title, body) {
      const { scheme, token } = await tokenFor(c);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/issues`, { method: 'POST', headers: GH_HEADERS(`${scheme} ${token}`), body: JSON.stringify({ title, body }) });
      if (!res.ok) throw new Error(`github create_issue ${res.status}`);
      const b = await res.json();
      return { number: b.number, url: b.html_url, nodeId: b.node_id };
    },
    async listPullRequests(c, repo, state) {
      const { scheme, token } = await tokenFor(c);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/pulls?state=${encodeURIComponent(state)}&per_page=30`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github list_prs ${res.status}`);
      return ((await res.json()) ?? []).map((p: any) => ({ number: p.number, title: p.title, state: p.state }));
    },
    async getPullRequest(c, repo, number) {
      const { scheme, token } = await tokenFor(c);
      const base = apiBaseFor(c.baseUrl);
      const res = await fetchImpl(`${base}/repos/${repo}/pulls/${number}`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github get_pr ${res.status}`);
      const b = await res.json();
      const diffRes = await fetchImpl(`${base}/repos/${repo}/pulls/${number}`, { method: 'GET', headers: { ...GH_HEADERS(`${scheme} ${token}`), accept: 'application/vnd.github.v3.diff' } });
      const rawDiff = diffRes.ok ? await diffRes.text() : '';
      const diff = rawDiff.length > MAX_DIFF_CHARS ? rawDiff.slice(0, MAX_DIFF_CHARS) : rawDiff;
      return { number: b.number, title: b.title, state: b.state, body: b.body ?? '', diff };
    },
    async listCommits(c, repo, opts) {
      const { scheme, token } = await tokenFor(c);
      const perPage = Math.min(opts.perPage ?? 20, 50);
      const params = new URLSearchParams({ per_page: String(perPage) });
      if (opts.path) params.set('path', opts.path);
      if (opts.since) params.set('since', opts.since);
      if (opts.until) params.set('until', opts.until);
      if (opts.sha) params.set('sha', opts.sha);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/commits?${params.toString()}`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github list_commits ${res.status}`);
      return ((await res.json()) ?? []).map((c: any) => ({
        sha: c.sha as string,
        shortSha: (c.sha as string).slice(0, 7),
        message: ((c.commit?.message ?? '') as string).split('\n')[0]!,
        author: (c.author?.login ?? c.commit?.author?.name ?? '') as string,
        date: c.commit?.author?.date as string,
        url: c.html_url as string,
      }));
    },
    async getCommit(c, repo, sha) {
      const { scheme, token } = await tokenFor(c);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/commits/${encodeURIComponent(sha)}`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github get_commit ${res.status}`);
      const b = await res.json();
      let budget = MAX_DIFF_CHARS;
      const files = ((b.files ?? []) as any[]).map((f) => {
        const rawPatch = f.patch as string | undefined;
        const patch = rawPatch !== undefined ? rawPatch.slice(0, Math.max(0, budget)) : undefined;
        if (rawPatch !== undefined) budget = Math.max(0, budget - rawPatch.length);
        return { filename: f.filename as string, status: f.status as string, additions: f.additions as number, deletions: f.deletions as number, patch };
      });
      return {
        sha: b.sha as string,
        message: ((b.commit?.message ?? '') as string).split('\n')[0]!,
        author: (b.author?.login ?? b.commit?.author?.name ?? '') as string,
        date: b.commit?.author?.date as string,
        url: b.html_url as string,
        stats: { additions: b.stats?.additions ?? 0, deletions: b.stats?.deletions ?? 0, total: b.stats?.total ?? 0 },
        files,
      };
    },
    async listTree(c, repo, ref) {
      const { scheme, token } = await tokenFor(c);
      const res = await fetchImpl(`${apiBaseFor(c.baseUrl)}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { method: 'GET', headers: GH_HEADERS(`${scheme} ${token}`) });
      if (!res.ok) throw new Error(`github list_tree ${res.status}`);
      const b = await res.json();
      return { truncated: !!b.truncated, entries: ((b.tree ?? []) as any[]).map((e) => ({ path: e.path, type: e.type, sha: e.sha, size: e.size })) };
    },
  };
}

export const realGithubClient: GithubClient = makeClient(globalThis.fetch as unknown as FetchImpl);

export const makeGithubClientForTest = (fetchImpl: FetchImpl): GithubClient => makeClient(fetchImpl);

/** Resolve GitHub credentials from an OrgIntegration row + runtime config.
 *  Single source of truth shared by server (tools.ts, routes/github.ts) and graph-builder. */
export function credsForRow(
  row: OrgIntegration,
  cfg: { SECRETS_KEY?: string; GITHUB_APP_ID?: string; GITHUB_APP_PRIVATE_KEY?: string },
): Creds {
  const meta = (row.metadata as IntegrationMetadata) ?? {};
  if (row.mode === 'pat') {
    return { mode: 'pat', token: decryptSecret(row.secretCiphertext!, keyFromBase64(cfg.SECRETS_KEY!)), baseUrl: row.baseUrl ?? undefined };
  }
  if (row.mode === 'agent_app') {
    return { mode: 'agent_app', appId: cfg.GITHUB_APP_ID!, privateKey: cfg.GITHUB_APP_PRIVATE_KEY!, installationId: meta.installationId! };
  }
  return {
    mode: 'custom_app',
    appId: meta.appId!,
    privateKey: decryptSecret(row.secretCiphertext!, keyFromBase64(cfg.SECRETS_KEY!)),
    installationId: meta.installationId!,
    baseUrl: row.baseUrl ?? undefined,
  };
}
