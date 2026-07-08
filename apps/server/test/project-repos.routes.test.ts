import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, upsertIntegration, getIntegration, upsertCatalogRepo } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

// resolveOrg reads the subdomain from x-forwarded-host; testConfig.BASE_URL = 'https://beecause.ai'
const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
// A second org with no GitHub integration
const NGH_HOST = { 'x-forwarded-host': 'nogh.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

let cookieU1: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });

  // ── Org 'acme' — has a GitHub integration ───────────────────────────────────
  const acme = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });

  // Project 'web' in acme
  const webProject = await createProject(t.db, acme.id, { name: 'Web', slug: 'web' });
  // u1 is already org owner (→ project admin), but add explicit membership to be safe
  await addProjectMember(t.db, acme.id, webProject.id, 'u1', 'admin');

  // Seed a GitHub integration (agent_app mode — no ciphertext needed)
  await upsertIntegration(t.db, {
    orgId: acme.id,
    provider: 'github',
    mode: 'agent_app',
    accountLabel: 'acme-corp',
    metadata: { installationId: '12345', events: { issues: true, pullRequests: true, branches: true } },
    connectedByUserId: 'u1',
    lastTestOk: true,
  });
  const intg = await getIntegration(t.db, acme.id, 'github');

  // Seed a catalog row so addProjectRepo can pick up defaultBranch
  await upsertCatalogRepo(t.db, intg!.id, {
    repoFullName: 'acme/web',
    defaultBranch: 'main',
    private: false,
  });

  // ── Org 'nogh' — no GitHub integration ──────────────────────────────────────
  const nogh = await createOrgWithOwner(t.db, { name: 'NoGH', slug: 'nogh', userId: 'u1' });

  // Project 'app' in nogh (u1 is owner so project admin)
  await createProject(t.db, nogh.id, { name: 'App', slug: 'app' });

  // ── Session token (u1 is owner of both orgs) ──────────────────────────────
  cookieU1 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u1', email: 'u1@example.com' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

describe('project repos routes', () => {
  it('adds, lists and removes a repo in scope (admin)', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/org/projects/web/repos',
      cookies: cookieU1, headers: ACM_HOST,
      payload: { repoFullName: 'acme/web' },
    });
    expect(add.statusCode).toBe(201);
    const repoId = add.json().id;
    expect(typeof repoId).toBe('string');

    const list = await app.inject({
      method: 'GET', url: '/api/org/projects/web/repos',
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((r: { repoFullName: string }) => r.repoFullName)).toEqual(['acme/web']);

    const dup = await app.inject({
      method: 'POST', url: '/api/org/projects/web/repos',
      cookies: cookieU1, headers: ACM_HOST,
      payload: { repoFullName: 'acme/web' },
    });
    expect(dup.statusCode).toBe(409);

    const del = await app.inject({
      method: 'DELETE', url: `/api/org/projects/web/repos/${repoId}`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(del.statusCode).toBe(204);

    // After delete, list is empty
    const listAfter = await app.inject({
      method: 'GET', url: '/api/org/projects/web/repos',
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(listAfter.json()).toHaveLength(0);
  });

  it('422 when GitHub is not connected', async () => {
    // Org 'nogh' has no GitHub integration — POST /repos returns 422
    const res = await app.inject({
      method: 'POST', url: '/api/org/projects/app/repos',
      cookies: cookieU1, headers: NGH_HOST,
      payload: { repoFullName: 'acme/x' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/connect GitHub/);
  });
});
