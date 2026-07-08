import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, createProject, upsertIntegration, getIntegration, encryptSecret, addProjectRepo, createBuild, finishBuild } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';
import { githubToolDefs } from '../src/integrations/github/tools.js';
import { knowledgeGraphToolDefs } from '../src/integrations/knowledge-graph/tools.js';

const HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
const config: AppConfig = { ...testConfig, SECRETS_KEY };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let slug: string;
let slugNoGithub: string;
let cookie: Record<string, string>;
let orgId: string;
let projId: string;
let intgId: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api });

  // Org with github integration connected + enabled (default)
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id);
  orgId = org.id;
  const proj = await createProject(t.db, org.id, { name: 'P', slug: 'p' });
  slug = proj.slug;
  projId = proj.id;

  const secretsKey = Buffer.alloc(32, 1);
  const secretCiphertext = encryptSecret('ghp_dummy', secretsKey);
  await upsertIntegration(t.db, {
    orgId: org.id,
    provider: 'github',
    mode: 'pat',
    secretCiphertext,
    connectedByUserId: 'u-owner',
    metadata: {},
  });
  const intg = await getIntegration(t.db, org.id, 'github');
  intgId = intg!.id;

  cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'o@x.dev' }, config.SESSION_SECRET) };

  // Org with no github integration
  const org2 = await createOrgWithOwner(t.db, { name: 'Bare', slug: 'bare', userId: 'u-bare' });
  await activateOrg(t.db, org2.id);
  const proj2 = await createProject(t.db, org2.id, { name: 'Q', slug: 'q' });
  slugNoGithub = proj2.slug;
});

afterAll(async () => {
  await app.close();
  await t.stop();
});

describe('GET /api/org/projects/:slug/integration-tools', () => {
  it('returns github tool names when integration is connected and enabled', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/integration-tools`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: { name: string; mutates: boolean; description: string }[] };
    const names = body.tools.map((t) => t.name);
    expect(names).toContain('integration.github.get_file');
    expect(names).toContain('integration.github.create_issue');
    // Should match the full githubToolDefs catalog
    expect(names).toHaveLength(githubToolDefs().length);
  });

  it('returns mutates flag correctly', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/integration-tools`, cookies: cookie, headers: HOST });
    const body = res.json() as { tools: { name: string; mutates: boolean; description: string }[] };
    const getFile = body.tools.find((t) => t.name === 'integration.github.get_file');
    const createIssue = body.tools.find((t) => t.name === 'integration.github.create_issue');
    expect(getFile?.mutates).toBe(false);
    expect(createIssue?.mutates).toBe(true);
  });

  it('returns empty tools array when org has no github integration', async () => {
    // The bare org user needs a cookie too
    const bareCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-bare', email: 'bare@x.dev' }, config.SESSION_SECRET) };
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slugNoGithub}/integration-tools`, cookies: bareCookie, headers: { 'x-forwarded-host': 'bare.beecause.ai' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toEqual([]);
  });

  it('does NOT include slack tools even when slack integration is connected and enabled', async () => {
    await upsertIntegration(t.db, {
      orgId,
      provider: 'slack',
      mode: 'oauth',
      secretCiphertext: encryptSecret('xoxb-dummy', Buffer.alloc(32, 1)),
      connectedByUserId: 'u-owner',
      metadata: {},
    });
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/integration-tools`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names.some((n) => n.startsWith('integration.slack.'))).toBe(false);
  });

  it('does NOT include KG tools when project has no built graph', async () => {
    // No repo or build seeded yet — KG tools must be absent
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/integration-tools`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    const kgNames = knowledgeGraphToolDefs().map((d) => d.name);
    for (const n of kgNames) expect(names).not.toContain(n);
  });

  it('DOES include all 4 KG tools when project has a repo with a done build', async () => {
    // Seed: add repo to project, create a finished build
    await addProjectRepo(t.db, {
      projectId: projId,
      orgIntegrationId: intgId,
      repoFullName: 'acme/p-repo',
      defaultBranch: 'main',
      addedByUserId: 'u-owner',
    });
    const build = await createBuild(t.db, { orgId, repoFullName: 'acme/p-repo', mode: 'manual' });
    await finishBuild(t.db, build.id, { status: 'done', nodesAnalyzed: 0 });

    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/integration-tools`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    const kgNames = knowledgeGraphToolDefs().map((d) => d.name);
    expect(kgNames).toHaveLength(4);
    for (const n of kgNames) expect(names).toContain(n);
  });
});
