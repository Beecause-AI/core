import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, type SentryClient } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
};

const stubSentryClient: SentryClient = {
  async getOrganization() { return { slug: 'acme', name: 'Acme' }; },
  async listProjects() { return [{ id: '111', slug: 'web', name: 'Web' }, { id: '222', slug: 'api', name: 'Api' }]; },
  async listIssues() { return [{ id: '1', title: 'boom' }]; },
  async getIssue() { return { id: '42', project: { slug: 'web' } }; },
  async getLatestEvent() { return { eventID: 'e1' }; },
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, sentryClient: stubSentryClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

const createConnection = async (name = 'Prod') => {
  const res = await inject('POST', '/api/integrations/sentry/connections', {
    name, sentryOrgSlug: 'acme', authToken: 'sntrys_secret_token',
  });
  expect(res.statusCode).toBe(200);
  return res.json().connection as { id: string; name: string; baseUrl: string; metadata: Record<string, unknown>; secretHint: string };
};

describe('org Sentry connections (org admin)', () => {
  it('creates a connection (200), defaults baseUrl, stores org slug, never leaks the secret', async () => {
    const conn = await createConnection('Prod SA');
    expect(conn.name).toBe('Prod SA');
    expect(conn.baseUrl).toBe('https://sentry.io');
    expect(conn.metadata.sentryOrgSlug).toBe('acme');
    expect(conn.secretHint).toBe('…oken');
    expect(JSON.stringify(conn)).not.toContain('sntrys_secret_token');
    expect('secretCiphertext' in conn).toBe(false);

    const list = await inject('GET', '/api/integrations/sentry/connections');
    expect(list.statusCode).toBe(200);
    expect(list.json().connections.some((c: { id: string }) => c.id === conn.id)).toBe(true);
  });

  it('accepts a self-hosted baseUrl and normalizes the trailing slash', async () => {
    const res = await inject('POST', '/api/integrations/sentry/connections', {
      name: 'Self-hosted', sentryOrgSlug: 'acme', baseUrl: 'https://sentry.acme.internal/', authToken: 'tok',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().connection.baseUrl).toBe('https://sentry.acme.internal');
  });

  it('rejects a connection with no auth token (400)', async () => {
    const res = await inject('POST', '/api/integrations/sentry/connections', { name: 'X', sentryOrgSlug: 'acme' });
    expect(res.statusCode).toBe(400);
  });

  it('tests a connection (200 ok)', async () => {
    const conn = await createConnection('Testable');
    const res = await inject('POST', `/api/integrations/sentry/connections/${conn.id}/test`);
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('patches the connection name', async () => {
    const conn = await createConnection('Before');
    const res = await inject('PATCH', `/api/integrations/sentry/connections/${conn.id}`, { name: 'After' });
    expect(res.statusCode).toBe(200);
    expect(res.json().connection.name).toBe('After');
  });

  it('deletes a connection (204)', async () => {
    const conn = await createConnection('Temp');
    const res = await inject('DELETE', `/api/integrations/sentry/connections/${conn.id}`);
    expect(res.statusCode).toBe(204);
  });
});

describe('project Sentry binding + scope (project admin)', () => {
  it('binds a connection, discovers projects, manages scope targets', async () => {
    const conn = await createConnection('Bound');

    // No binding yet.
    const before = await inject('GET', '/api/org/projects/web/sentry/connection');
    expect(before.json().connection).toBeNull();

    // Bind.
    const bind = await inject('PUT', '/api/org/projects/web/sentry/connection', { connectionId: conn.id });
    expect(bind.statusCode).toBe(200);
    const after = await inject('GET', '/api/org/projects/web/sentry/connection');
    expect(after.json().connection.id).toBe(conn.id);

    // Discovery.
    const disc = await inject('GET', `/api/org/projects/web/sentry/discovery/projects?connectionId=${conn.id}`);
    expect(disc.statusCode).toBe(200);
    expect(disc.json().projects).toEqual([
      { id: '111', slug: 'web', name: 'Web' },
      { id: '222', slug: 'api', name: 'Api' },
    ]);

    // Add a scope target.
    const add = await inject('POST', '/api/org/projects/web/sentry/targets', { sentryProjectSlug: 'web', sentryProjectId: '111', name: 'Web' });
    expect(add.statusCode).toBe(200);
    const targetId = add.json().target.id as string;

    // Duplicate → 409.
    const dup = await inject('POST', '/api/org/projects/web/sentry/targets', { sentryProjectSlug: 'web', sentryProjectId: '111', name: 'Web' });
    expect(dup.statusCode).toBe(409);

    // List.
    const list = await inject('GET', '/api/org/projects/web/sentry/targets');
    expect(list.json().targets.map((t: { sentryProjectSlug: string }) => t.sentryProjectSlug)).toEqual(['web']);

    // Remove target, then unbind (clears remaining scope).
    expect((await inject('DELETE', `/api/org/projects/web/sentry/targets/${targetId}`)).statusCode).toBe(204);
    expect((await inject('DELETE', '/api/org/projects/web/sentry/connection')).statusCode).toBe(204);
    expect((await inject('GET', '/api/org/projects/web/sentry/connection')).json().connection).toBeNull();
  });

  it('rejects adding a target before a connection is bound', async () => {
    // Fresh project with no binding.
    const res = await inject('POST', '/api/org/projects/web/sentry/targets', { sentryProjectSlug: 'x', sentryProjectId: '9', name: 'X' });
    expect(res.statusCode).toBe(400);
  });
});

describe('project-level Sentry connections (project admin)', () => {
  it('creates a project-owned connection from the project page and auto-binds it', async () => {
    const res = await inject('POST', '/api/org/projects/web/sentry/connections', {
      name: 'Project conn', sentryOrgSlug: 'acme', authToken: 'sntrys_project_token',
    });
    expect(res.statusCode).toBe(200);
    const conn = res.json().connection as { id: string; projectId: string | null };
    expect(conn.projectId).not.toBeNull(); // project-owned, not org-shared
    expect(JSON.stringify(conn)).not.toContain('sntrys_project_token');

    // Auto-bound.
    const bound = await inject('GET', '/api/org/projects/web/sentry/connection');
    expect(bound.json().connection.id).toBe(conn.id);

    // Project-private: it must NOT appear in the org-shared connections list.
    const orgList = await inject('GET', '/api/integrations/sentry/connections');
    expect(orgList.json().connections.some((c: { id: string }) => c.id === conn.id)).toBe(false);
  });

  it('tests the bound connection from the project page', async () => {
    const res = await inject('POST', '/api/org/projects/web/sentry/connection/test');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('deletes a project-owned connection and unbinds it', async () => {
    const bound = await inject('GET', '/api/org/projects/web/sentry/connection');
    const id = bound.json().connection.id as string;
    const del = await inject('DELETE', `/api/org/projects/web/sentry/connections/${id}`);
    expect(del.statusCode).toBe(204);
    expect((await inject('GET', '/api/org/projects/web/sentry/connection')).json().connection).toBeNull();
  });

  it('refuses to delete an org-shared connection via the project endpoint', async () => {
    const shared = await createConnection('Org shared');
    const res = await inject('DELETE', `/api/org/projects/web/sentry/connections/${shared.id}`);
    expect(res.statusCode).toBe(404);
    // Still present at the org level.
    const orgList = await inject('GET', '/api/integrations/sentry/connections');
    expect(orgList.json().connections.some((c: { id: string }) => c.id === shared.id)).toBe(true);
  });
});
