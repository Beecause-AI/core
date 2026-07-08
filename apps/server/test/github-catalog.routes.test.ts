/**
 * Tests for:
 *   GET  /api/org/integrations/github/catalog          (searched/paged)
 *   POST /api/org/integrations/github/catalog/sync     (advance one page)
 *   POST /api/org/integrations/github/catalog/refresh  (reset + advance)
 *
 * Stub injection: buildApp accepts githubClient in AppDeps and forwards it
 * to projectRoutes(app, { githubClient }).
 *
 * Integration mode: agent_app — advanceCatalogSync skips decryptSecret for
 * agent_app and calls client.listReposDetailed with the config-provided
 * GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY. Because the stub ignores its args,
 * we just need non-empty values for those config keys.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, upsertIntegration } from '@intellilabs/core';
import type { AppConfig } from '../src/config.js';
import type { GithubClient } from '../src/integrations/github/client.js';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
// A second org with no GitHub integration (exercises the 422 branch)
const NOGH_HOST = { 'x-forwarded-host': 'nogh.beecause.ai' };

// Config extended with GitHub App fields (required by advanceCatalogSync for agent_app mode)
// and a SECRETS_KEY (required by secretsKey() in catalog routes even though agent_app
// mode never calls decryptSecret).
const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
  GITHUB_APP_ID: '9999',
  GITHUB_APP_PRIVATE_KEY: 'stub-pem-not-used',
};

// Stub client: listReposDetailed returns the paged shape
const stub = {
  listReposDetailed: async ({ page }: { page?: number }) => (
    (page ?? 1) === 1
      ? { repos: [{ fullName: 'acme/a', defaultBranch: 'main', private: false }, { fullName: 'acme/b', defaultBranch: 'main', private: true }], nextPage: null }
      : { repos: [], nextPage: null }
  ),
} as any;

const stubClient: GithubClient = {
  async probePat() { return { ok: false, status: 401, detail: 'stub' }; },
  async probeApp() { return { ok: true, accountLabel: 'stub-org' }; },
  async installationAccount() { return 'stub-org'; },
  async listRepos() { return []; },
  ...stub,
} as unknown as GithubClient;

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let cookieU1: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  // githubClient is forwarded from AppDeps → projectRoutes({ githubClient }) in app.ts
  app = await buildApp({ db: t.db, store: t.store, config, githubClient: stubClient });

  // Seed org 'acme' with u1 as owner
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });
  await activateOrg(t.db, org.id);

  // Seed a GitHub integration (agent_app mode — no ciphertext needed)
  await upsertIntegration(t.db, {
    orgId: org.id,
    provider: 'github',
    mode: 'agent_app',
    accountLabel: 'acme-corp',
    metadata: { installationId: '99999', events: { issues: true, pullRequests: true, branches: true } },
    connectedByUserId: 'u1',
    lastTestOk: true,
  });

  // ── Org 'nogh' — no GitHub integration (for 422 coverage) ──────────────────
  const orgNoGh = await createOrgWithOwner(t.db, { name: 'NoGH', slug: 'nogh', userId: 'u1' });
  await activateOrg(t.db, orgNoGh.id);

  cookieU1 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u1', email: 'u1@example.com' }, config.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

describe('github catalog routes', () => {
  it('GET returns empty + idle/stale sync before any sync', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/integrations/github/catalog', cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.repos).toEqual([]); expect(b.total).toBe(0);
    expect(b.sync.status).toBe('idle'); expect(b.sync.stale).toBe(true); expect(b.nextCursor).toBeNull();
  });

  it('POST /sync advances to done; GET then returns the repos', async () => {
    const s = await app.inject({ method: 'POST', url: '/api/org/integrations/github/catalog/sync', cookies: cookieU1, headers: ACM_HOST });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ done: true, repoCount: 2, status: 'idle' });
    const g = await app.inject({ method: 'GET', url: '/api/org/integrations/github/catalog?q=acme', cookies: cookieU1, headers: ACM_HOST });
    expect(g.json().repos.map((r: any) => r.repoFullName)).toEqual(['acme/a', 'acme/b']);
    expect(g.json().total).toBe(2); expect(g.json().sync.stale).toBe(false);
  });

  it('GET paginates with cursor + limit', async () => {
    await app.inject({ method: 'POST', url: '/api/org/integrations/github/catalog/sync', cookies: cookieU1, headers: ACM_HOST });
    const p1 = await app.inject({ method: 'GET', url: '/api/org/integrations/github/catalog?limit=1', cookies: cookieU1, headers: ACM_HOST });
    expect(p1.json().repos).toHaveLength(1);
    expect(p1.json().nextCursor).toBe('acme/a');
    const p2 = await app.inject({ method: 'GET', url: `/api/org/integrations/github/catalog?limit=1&cursor=${encodeURIComponent('acme/a')}`, cookies: cookieU1, headers: ACM_HOST });
    expect(p2.json().repos.map((r: any) => r.repoFullName)).toEqual(['acme/b']);
  });

  it('refresh re-syncs (admin)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/org/integrations/github/catalog/refresh', cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ done: true, repoCount: 2 });
  });

  it('422 when GitHub not connected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/integrations/github/catalog', cookies: cookieU1, headers: NOGH_HOST });
    expect(res.statusCode).toBe(422);
  });
});
