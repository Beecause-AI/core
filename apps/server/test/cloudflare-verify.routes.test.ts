import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, type CloudflareClient } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

// resolveOrg reads the subdomain from x-forwarded-host; config.BASE_URL host is beecause.ai
const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
};

// A stub client whose probe queries all succeed → all three signals available.
const okClient: CloudflareClient = {
  async queryGraphql() { return {}; },
  async queryWorkerLogs() { return {}; },
  async verifyToken() { return {}; },
  async listAccounts() { return { result: [] }; },
  async listZones() { return { result: [] }; },
  async listWorkerScripts() { return { result: [] }; },
};

// A client whose graphql throws → analytics/logs fail; workers also throws.
const throwClient: CloudflareClient = {
  async queryGraphql() { throw new Error('Cloudflare 403: forbidden'); },
  async queryWorkerLogs() { throw new Error('Cloudflare 403: forbidden'); },
  async verifyToken() { return {}; },
  async listAccounts() { return { result: [] }; },
  async listZones() { return { result: [] }; },
  async listWorkerScripts() { return { result: [] }; },
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, cloudflareClient: okClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  const proj2 = await createProject(t.db, org.id, { name: 'Api', slug: 'api' });
  await addProjectMember(t.db, org.id, proj2.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>, instance: FastifyInstance = app) =>
  instance.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

// Create an org connection (api_token mode requires accountId).
const createConnection = async (name: string, accountId?: string, instance: FastifyInstance = app) => {
  const res = await inject('POST', '/api/integrations/cloudflare/connections', {
    name, ...(accountId ? { accountId } : {}), mode: 'global_key', email: 'a@b.dev', apiKey: 'k-secret',
  }, instance);
  expect(res.statusCode).toBe(200);
  return res.json().connection as { id: string; name: string; metadata: Record<string, unknown> };
};

describe('org Cloudflare verify (org admin)', () => {
  it('verify probes the account and persists availableSignals + lastTestOk (200)', async () => {
    const conn = await createConnection('Verify Me', 'acct-123');
    const res = await inject('POST', `/api/integrations/cloudflare/connections/${conn.id}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect([...body.availableSignals].sort()).toEqual(['analytics', 'logs', 'workers']);
    expect(body.report.analytics.ok).toBe(true);

    const list = await inject('GET', '/api/integrations/cloudflare/connections');
    const row = list.json().connections.find((c: { id: string }) => c.id === conn.id);
    expect([...row.metadata.availableSignals].sort()).toEqual(['analytics', 'logs', 'workers']);
    expect(row.lastTestOk).toBe(true);
  });

  it('verify of a missing connection → 404', async () => {
    const res = await inject('POST', '/api/integrations/cloudflare/connections/00000000-0000-0000-0000-000000000000/verify');
    expect(res.statusCode).toBe(404);
  });

  it('verify of a connection without an account id → 400', async () => {
    const conn = await createConnection('No Account'); // no accountId
    const res = await inject('POST', `/api/integrations/cloudflare/connections/${conn.id}/verify`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no account id/i);
  });

  it('verify returns 200 with all-failed report when the probe queries throw', async () => {
    // Probe failures are captured per-signal (not thrown) → ok:false, lastTestOk:false.
    const failApp = await buildApp({ db: t.db, store: t.store, config, cloudflareClient: throwClient });
    try {
      const conn = await createConnection('Throws', 'acct-throws', failApp);
      const res = await inject('POST', `/api/integrations/cloudflare/connections/${conn.id}/verify`, undefined, failApp);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.availableSignals).toEqual([]);
      expect(body.report.analytics.ok).toBe(false);

      const list = await inject('GET', '/api/integrations/cloudflare/connections', undefined, failApp);
      const row = list.json().connections.find((c: { id: string }) => c.id === conn.id);
      expect(row.lastTestOk).toBe(false);
    } finally {
      await failApp.close();
    }
  });
});

describe('project Cloudflare verify (project admin)', () => {
  it('verifies the connection the project is bound to (200)', async () => {
    const conn = await createConnection('Bound Verify', 'acct-bound');
    const put = await inject('PUT', '/api/org/projects/web/cloudflare/connection', { connectionId: conn.id });
    expect(put.statusCode).toBe(200);

    const res = await inject('POST', '/api/org/projects/web/cloudflare/connection/verify');
    expect(res.statusCode).toBe(200);
    expect([...res.json().availableSignals].sort()).toEqual(['analytics', 'logs', 'workers']);

    const list = await inject('GET', '/api/integrations/cloudflare/connections');
    const row = list.json().connections.find((c: { id: string }) => c.id === conn.id);
    expect([...row.metadata.availableSignals].sort()).toEqual(['analytics', 'logs', 'workers']);
  });

  it('project verify with no bound connection → 400', async () => {
    // 'api' project has no binding.
    const res = await inject('POST', '/api/org/projects/api/cloudflare/connection/verify');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no connection bound/i);
  });
});
