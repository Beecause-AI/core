import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import type { GithubClient } from '../src/integrations/github/client.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
  GITHUB_APP_ID: '4015121',
  GITHUB_APP_SLUG: 'intellilabs-agent',
  GITHUB_APP_PRIVATE_KEY: 'unused-by-fake-client',
  INTEGRATION_STATE_SECRET: 'k'.repeat(40),
};

const fakeClient: GithubClient = {
  async probePat({ token }) { return token.includes('bad') ? { ok: false, status: 401, detail: 'bad token' } : { ok: true, status: 200, accountLabel: 'acme-corp' }; },
  async probeApp({ appId }) { return appId === '999' ? { ok: false, detail: 'bad app' } : { ok: true, accountLabel: 'acme-corp' }; },
  async installationAccount() { return 'acme-corp'; },
  async listRepos() { return ['acme-corp/web', 'acme-corp/api']; },
  async listReposDetailed() { return { repos: [{ fullName: 'acme-corp/web', defaultBranch: 'main', private: false }, { fullName: 'acme-corp/api', defaultBranch: 'main', private: true }], nextPage: null }; },
  async getFile() { throw new Error('not implemented'); },
  async listDirectory() { return []; },
  async getRefInfo() { throw new Error('not implemented'); },
  async searchCode() { return []; },
  async searchIssues() { return []; },
  async getIssue() { return { number: 0, title: '', state: 'open', body: '' }; },
  async createIssue() { return { number: 0, url: '', nodeId: '' }; },
  async listPullRequests() { return []; },
  async getPullRequest() { return { number: 0, title: '', state: 'open', body: '', diff: '' }; },
  async listCommits() { return []; },
  async getCommit() { throw new Error('not implemented'); },
  async listTree() { return { truncated: false, entries: [] }; },};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;
let userCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api, githubClient: fakeClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id);
  const memberId = `${org.id}_u-user`;
  await t.store.db.collection('org_members').doc(memberId).set({ id: memberId, orgId: org.id, userId: 'u-user', role: 'user', createdAt: new Date() });
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-user', email: 'user@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const get = (url: string, cookies = ownerCookie) => app.inject({ method: 'GET', url, cookies, headers: ACM_HOST });
const putPat = (payload: Record<string, unknown>, cookies = ownerCookie) =>
  app.inject({ method: 'PUT', url: '/api/github/connection/pat', cookies, headers: ACM_HOST, payload });
const putCustom = (payload: Record<string, unknown>, cookies = ownerCookie) =>
  app.inject({ method: 'PUT', url: '/api/github/connection/custom-app', cookies, headers: ACM_HOST, payload });
const del = (cookies = ownerCookie) => app.inject({ method: 'DELETE', url: '/api/github/connection', cookies, headers: ACM_HOST });

describe('GET /api/github/connection', () => {
  it('returns null before any connection', async () => {
    const res = await get('/api/github/connection');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

describe('PUT pat — probe-on-save', () => {
  it('stores a valid PAT (201), metadata only, never the token', async () => {
    const token = 'ghp_goodtoken123';
    const res = await putPat({ token });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ provider: 'github', mode: 'pat', accountLabel: 'acme-corp', secretHint: '…n123' });
    expect(body.secretCiphertext).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(token);
    await del();
  });

  it('rejects an invalid PAT (400) and stores nothing', async () => {
    const res = await putPat({ token: 'ghp_badtoken99' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'token rejected', detail: 'bad token' });
    expect((await get('/api/github/connection')).json()).toBeNull();
  });

  it('rejects an unsafe baseUrl (400, SSRF guard)', async () => {
    const res = await putPat({ token: 'ghp_goodtoken123', baseUrl: 'https://localhost/api' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not allowed/);
  });
});

describe('PUT custom-app — probe-on-save', () => {
  it('stores valid custom app creds (201)', async () => {
    const res = await putCustom({ appId: '12345', privateKey: 'x'.repeat(50), installationId: '777' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mode: 'custom_app', accountLabel: 'acme-corp' });
    await del();
  });
  it('rejects bad app creds (400)', async () => {
    const res = await putCustom({ appId: '999', privateKey: 'x'.repeat(50), installationId: '777' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'app credentials rejected' });
  });
});

describe('install-url + setup callback (agent_app)', () => {
  it('mints an install url then completes the install and connects the org', async () => {
    const urlRes = await app.inject({ method: 'POST', url: '/api/github/install-url', cookies: ownerCookie, headers: ACM_HOST });
    expect(urlRes.statusCode).toBe(200);
    const u = new URL(urlRes.json().url);
    expect(u.pathname).toBe('/apps/intellilabs-agent/installations/new');
    const state = u.searchParams.get('state')!;
    expect(state).toBeTruthy();

    const cb = await app.inject({ method: 'GET', url: `/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}` });
    expect([301, 302]).toContain(cb.statusCode);
    expect(cb.headers.location).toBe('https://acme.beecause.ai/admin/github?connected=1');

    const conn = (await get('/api/github/connection')).json();
    expect(conn).toMatchObject({ mode: 'agent_app', accountLabel: 'acme-corp' });
    expect(conn.metadata.installationId).toBe('555');
    await del();
  });

  it('rejects a forged state', async () => {
    const cb = await app.inject({ method: 'GET', url: '/api/github/setup?installation_id=1&state=not-a-real-state' });
    expect(cb.statusCode).toBe(400);
  });

  it('rejects a replayed state (nonce already consumed)', async () => {
    const urlRes = await app.inject({ method: 'POST', url: '/api/github/install-url', cookies: ownerCookie, headers: ACM_HOST });
    const state = new URL(urlRes.json().url).searchParams.get('state')!;
    const first = await app.inject({ method: 'GET', url: `/api/github/setup?installation_id=901&state=${encodeURIComponent(state)}` });
    expect([301, 302]).toContain(first.statusCode);
    const replay = await app.inject({ method: 'GET', url: `/api/github/setup?installation_id=901&state=${encodeURIComponent(state)}` });
    expect(replay.statusCode).toBe(400);
    await del();
  });
});

describe('repos / test / events', () => {
  it('lists repos, tests, and toggles events on a connected org', async () => {
    await putPat({ token: 'ghp_goodtoken123' });
    expect((await get('/api/github/connection/repos')).json()).toEqual({ repos: ['acme-corp/web', 'acme-corp/api'] });

    const tst = await app.inject({ method: 'POST', url: '/api/github/connection/test', cookies: ownerCookie, headers: ACM_HOST });
    expect(tst.json()).toMatchObject({ ok: true });

    const ev = await app.inject({ method: 'PATCH', url: '/api/github/connection/events', cookies: ownerCookie, headers: ACM_HOST, payload: { branches: false } });
    expect(ev.statusCode).toBe(200);
    expect(ev.json().metadata.events).toMatchObject({ issues: true, pullRequests: true, branches: false });
    await del();
  });

  it('repos 404s when not connected', async () => {
    expect((await get('/api/github/connection/repos')).statusCode).toBe(404);
  });
});

describe('guards', () => {
  it('hides routes from a plain user-role member (404)', async () => {
    expect((await get('/api/github/connection', userCookie)).statusCode).toBe(404);
  });
});

describe('connection test — listRepos failure degrades gracefully', () => {
  const throwingClient: GithubClient = {
    ...fakeClient,
    async listRepos() { throw new Error('network timeout'); },
  };

  let appT: FastifyInstance;
  let tT: Awaited<ReturnType<typeof startTestDb>>;
  let ownerCookieT: Record<string, string>;

  beforeAll(async () => {
    tT = await startTestDb();
    appT = await buildApp({ db: tT.db, store: tT.store, config, email: fakeEmail().api, githubClient: throwingClient });
    const org = await createOrgWithOwner(tT.db, { name: 'Throw Corp', slug: 'acme', userId: 'u-throw-owner' });
    await activateOrg(tT.db, org.id);
    ownerCookieT = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-throw-owner', email: 'owner@throw.dev' }, config.SESSION_SECRET) };
    // pre-connect a PAT so the test route finds an existing integration
    await appT.inject({ method: 'PUT', url: '/api/github/connection/pat', cookies: ownerCookieT, headers: ACM_HOST, payload: { token: 'ghp_goodtoken123' } });
  });
  afterAll(async () => { await appT.close(); await tT.stop(); });

  it('returns 200 with ok=true and repoCount=null when listRepos throws', async () => {
    const res = await appT.inject({ method: 'POST', url: '/api/github/connection/test', cookies: ownerCookieT, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.repoCount).toBeNull();
  });
});

describe('connection test — repo visibility', () => {
  it('connection test reports repo visibility, not just auth', async () => {
    await putPat({ token: 'ghp_goodtoken123' });
    const res = await app.inject({ method: 'POST', url: '/api/github/connection/test', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.repoCount).toBe(2);
    await del();
  });
});
