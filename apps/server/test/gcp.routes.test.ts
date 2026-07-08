import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, type GcpClient } from '@intellilabs/core';
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

// A dummy service-account key. Token minting is stubbed, so this is never used to mint a real token.
const DUMMY_SA = JSON.stringify({
  type: 'service_account',
  project_id: 'acme-prod',
  client_email: 'sa@acme-prod.iam.gserviceaccount.com',
  private_key: 'PRIVATE_KEY_DO_NOT_LEAK',
});

// Records the gcpProjectId the probe passes to the monitoring call, so tests can
// assert verify probed the connection's defaultGcpProjectId.
let probedProject: string | undefined;

// Stubs so probe/discovery pass deterministically without network/key material.
const stubGcpClient: GcpClient = {
  async listMetricDescriptors(_token: string, gcpProjectId: string) { probedProject = gcpProjectId; return { metricDescriptors: [] }; },
  async queryMetrics() { return {}; },
  async queryLogs() { return {}; },
  async listTraces() { return {}; },
  async getTrace() { return {}; },
  async listErrorGroups() { return { errorGroupStats: [] }; },
  async getErrorGroup() { return { stats: {}, events: {} }; },
  async listProjects() { return [{ id: 'acme-prod', name: 'Acme Prod' }, { id: 'acme-staging', name: 'Acme Staging' }]; },
  async reportErrorEvent() { return {}; },
};
// Capture the scopes each mint requests, so tests can assert the probe asks for
// a scope that can actually reach the Error Reporting API (cloud-platform).
const mintedScopes: string[][] = [];
const stubMintToken = async (_creds: unknown, scopes: string[]) => { mintedScopes.push(scopes); return 'stub-access-token'; };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({
    db: t.db, store: t.store,
    config,
    gcpClient: stubGcpClient,
    mintGcpToken: stubMintToken,
  });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  // A second project to test the cross-project visibility guard.
  const proj2 = await createProject(t.db, org.id, { name: 'Api', slug: 'api' });
  await addProjectMember(t.db, org.id, proj2.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

// Create an org connection and return its public row.
const createConnection = async (name: string, defaultGcpProjectId = 'acme-prod') => {
  const res = await inject('POST', '/api/integrations/gcp/connections', {
    name, defaultGcpProjectId, mode: 'sa_key', saKey: DUMMY_SA,
  });
  expect(res.statusCode).toBe(200);
  return res.json().connection as { id: string; name: string; metadata: Record<string, unknown> };
};

describe('org GCP connections (org admin)', () => {
  it('creates an sa_key connection (200), lists it, and never leaks the secret', async () => {
    const conn = await createConnection('Prod SA');
    expect(conn.name).toBe('Prod SA');
    expect(conn.metadata.defaultGcpProjectId).toBe('acme-prod');
    expect(conn.metadata.saEmail).toBe('sa@acme-prod.iam.gserviceaccount.com');

    const list = await inject('GET', '/api/integrations/gcp/connections');
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.connections.some((c: { id: string }) => c.id === conn.id)).toBe(true);
    const json = JSON.stringify(body);
    expect(json).not.toContain('PRIVATE_KEY_DO_NOT_LEAK');
    expect(json).not.toContain('secretCiphertext');
  });

  it('rejects create with a missing secret (400)', async () => {
    const res = await inject('POST', '/api/integrations/gcp/connections', {
      name: 'No Secret', defaultGcpProjectId: 'acme-prod', mode: 'sa_key',
    });
    expect(res.statusCode).toBe(400);
  });

  it('patches (rename) without credentials — keeps the stored secret (200)', async () => {
    const conn = await createConnection('Rename Me');
    const res = await inject('PATCH', `/api/integrations/gcp/connections/${conn.id}`, { name: 'Renamed' });
    expect(res.statusCode).toBe(200);
    expect(res.json().connection.name).toBe('Renamed');
    // Verify still works → the secret was preserved (decryptable).
    const verify = await inject('POST', `/api/integrations/gcp/connections/${conn.id}/verify`);
    expect(verify.statusCode).toBe(200);
  });

  it('verify probes the default project and stores availableSignals from the probe', async () => {
    const conn = await createConnection('Verify Me', 'verify-target-proj');
    probedProject = undefined;
    const res = await inject('POST', `/api/integrations/gcp/connections/${conn.id}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect([...body.availableSignals].sort()).toEqual(['errors', 'logging', 'monitoring', 'trace']);
    expect(body.report.monitoring.ok).toBe(true);
    // The probe used the connection's defaultGcpProjectId.
    expect(probedProject).toBe('verify-target-proj');

    // availableSignals persisted on the connection metadata.
    const list = await inject('GET', '/api/integrations/gcp/connections');
    const row = list.json().connections.find((c: { id: string }) => c.id === conn.id);
    expect([...row.metadata.availableSignals].sort()).toEqual(['errors', 'logging', 'monitoring', 'trace']);
  });

  it('verify mints a token with the cloud-platform scope so Error Reporting can be probed', async () => {
    const conn = await createConnection('Scope Check', 'scope-proj');
    mintedScopes.length = 0;
    const res = await inject('POST', `/api/integrations/gcp/connections/${conn.id}/verify`);
    expect(res.statusCode).toBe(200);
    // Error Reporting only accepts cloud-platform; the narrow read scopes 403 it
    // regardless of IAM role, so the probe must request cloud-platform.
    expect(mintedScopes.flat()).toContain('https://www.googleapis.com/auth/cloud-platform');
  });

  it('verify returns 502 with the error message when token minting fails', async () => {
    // A separate app whose token minter throws (bad/expired credentials).
    const failApp = await buildApp({
      db: t.db, store: t.store,
      config,
      gcpClient: stubGcpClient,
      mintGcpToken: async () => { throw new Error('failed to mint GCP access token (sa_key)'); },
    });
    try {
      const create = await failApp.inject({
        method: 'POST', url: '/api/integrations/gcp/connections', cookies: ownerCookie, headers: ACM_HOST,
        payload: { name: 'Bad Creds', defaultGcpProjectId: 'acme-prod', mode: 'sa_key', saKey: DUMMY_SA },
      });
      expect(create.statusCode).toBe(200);
      const connId = create.json().connection.id as string;

      const res = await failApp.inject({
        method: 'POST', url: `/api/integrations/gcp/connections/${connId}/verify`, cookies: ownerCookie, headers: ACM_HOST,
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toMatch(/failed to mint/);
    } finally {
      await failApp.close();
    }
  });

  it('deletes a connection (204)', async () => {
    const conn = await createConnection('Delete Me');
    const res = await inject('DELETE', `/api/integrations/gcp/connections/${conn.id}`);
    expect(res.statusCode).toBe(204);
    const again = await inject('DELETE', `/api/integrations/gcp/connections/${conn.id}`);
    expect(again.statusCode).toBe(404);
  });
});

describe('project binding + scope (project admin)', () => {
  it('binds a connection (PUT 200), then GET returns it', async () => {
    const conn = await createConnection('Bind Target');
    const put = await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: conn.id });
    expect(put.statusCode).toBe(200);
    expect(put.json().connection.id).toBe(conn.id);

    const get = await inject('GET', '/api/org/projects/web/gcp/connection');
    expect(get.statusCode).toBe(200);
    expect(get.json().connection.id).toBe(conn.id);
  });

  it('GET/POST/DELETE scope targets; duplicate gcpProjectId → 409', async () => {
    const conn = await createConnection('Scope Conn');
    await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: conn.id });

    const add = await inject('POST', '/api/org/projects/web/gcp/targets', { gcpProjectId: 'scope-proj-1', label: 'one' });
    expect(add.statusCode).toBe(200);
    const targetId = add.json().target.id;
    expect(add.json().target.gcpProjectId).toBe('scope-proj-1');

    const list = await inject('GET', '/api/org/projects/web/gcp/targets');
    expect(list.json().targets.some((tt: { id: string }) => tt.id === targetId)).toBe(true);

    const dup = await inject('POST', '/api/org/projects/web/gcp/targets', { gcpProjectId: 'scope-proj-1' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatch(/already in the scope/i);

    const del = await inject('DELETE', `/api/org/projects/web/gcp/targets/${targetId}`);
    expect(del.statusCode).toBe(204);
  });

  it('rejects a scope target when no connection is bound (400)', async () => {
    // 'api' project has no binding yet.
    const res = await inject('POST', '/api/org/projects/api/gcp/targets', { gcpProjectId: 'nope' });
    expect(res.statusCode).toBe(400);
  });

  it('switching the bound connection clears existing scope targets', async () => {
    const a = await createConnection('Switch A');
    const b = await createConnection('Switch B');
    await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: a.id });
    const add = await inject('POST', '/api/org/projects/web/gcp/targets', { gcpProjectId: 'switch-proj' });
    expect(add.statusCode).toBe(200);
    expect((await inject('GET', '/api/org/projects/web/gcp/targets')).json().targets.length).toBeGreaterThan(0);

    const put = await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: b.id });
    expect(put.statusCode).toBe(200);
    expect((await inject('GET', '/api/org/projects/web/gcp/targets')).json().targets).toHaveLength(0);
  });

  it('project verify probes the bound connection and persists the result (200)', async () => {
    const conn = await createConnection('Proj Verify', 'proj-verify-target');
    await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: conn.id });
    probedProject = undefined;
    const res = await inject('POST', '/api/org/projects/web/gcp/connection/verify');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect([...body.availableSignals].sort()).toEqual(['errors', 'logging', 'monitoring', 'trace']);
    expect(probedProject).toBe('proj-verify-target');
    // Persisted on the connection metadata (visible via the org connections list).
    const list = await inject('GET', '/api/integrations/gcp/connections');
    const row = list.json().connections.find((c: { id: string }) => c.id === conn.id);
    expect([...row.metadata.availableSignals].sort()).toEqual(['errors', 'logging', 'monitoring', 'trace']);
    expect(row.lastTestOk).toBe(true);
  });

  it('project verify falls back to a scoped target when the connection has no default project (200)', async () => {
    // Simulate a v2-migrated connection: bound, but no defaultGcpProjectId in metadata.
    const { addGcpConnection, encryptSecret, keyFromBase64, getOrgBySlug } = await import('@intellilabs/core');
    const org = await getOrgBySlug(t.db, 'acme');
    const noDefault = await addGcpConnection(t.db, {
      orgId: org!.id, name: 'No Default',
      mode: 'sa_key', secretCiphertext: encryptSecret(DUMMY_SA, keyFromBase64(config.SECRETS_KEY!)),
      metadata: {}, createdByUserId: 'u-owner',
    });
    await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: noDefault.id });
    const add = await inject('POST', '/api/org/projects/web/gcp/targets', { gcpProjectId: 'scoped-fallback-proj' });
    expect(add.statusCode).toBe(200);

    probedProject = undefined;
    const res = await inject('POST', '/api/org/projects/web/gcp/connection/verify');
    expect(res.statusCode).toBe(200);
    expect([...res.json().availableSignals].sort()).toEqual(['errors', 'logging', 'monitoring', 'trace']);
    // The probe fell back to the scoped target's gcpProjectId.
    expect(probedProject).toBe('scoped-fallback-proj');
  });

  it('project verify with no default project and no scoped targets → 400', async () => {
    // Bound connection with no defaultGcpProjectId and an empty scope.
    const { addGcpConnection, encryptSecret, keyFromBase64, getOrgBySlug } = await import('@intellilabs/core');
    const org = await getOrgBySlug(t.db, 'acme');
    const noDefault = await addGcpConnection(t.db, {
      orgId: org!.id, name: 'No Default No Scope',
      mode: 'sa_key', secretCiphertext: encryptSecret(DUMMY_SA, keyFromBase64(config.SECRETS_KEY!)),
      metadata: {}, createdByUserId: 'u-owner',
    });
    // Binding switches scope to empty (clears any prior targets on 'web').
    await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: noDefault.id });
    expect((await inject('GET', '/api/org/projects/web/gcp/targets')).json().targets).toHaveLength(0);

    const res = await inject('POST', '/api/org/projects/web/gcp/connection/verify');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no GCP project to verify against/i);
  });

  it('project verify with no bound connection → 400', async () => {
    // 'api' project has no binding.
    const res = await inject('POST', '/api/org/projects/api/gcp/connection/verify');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no connection bound/i);
  });

  it('discovery lists reachable GCP projects via the stubbed client', async () => {
    const conn = await createConnection('Discover');
    const res = await inject('GET', `/api/org/projects/web/gcp/discovery/projects?connectionId=${conn.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().result.map((p: { id: string }) => p.id)).toContain('acme-prod');
  });
});

describe('cross-project visibility guard', () => {
  it('a project cannot bind another project\'s project-owned connection (400)', async () => {
    // Create a connection owned by the 'api' project directly in the DB layer.
    const { addGcpConnection, encryptSecret, keyFromBase64, getProjectBySlug } = await import('@intellilabs/core');
    const org = await (await import('@intellilabs/core')).getOrgBySlug(t.db, 'acme');
    const apiProj = await getProjectBySlug(t.db, org!.id, 'api');
    const owned = await addGcpConnection(t.db, {
      orgId: org!.id, projectId: apiProj!.id, name: 'Api Owned',
      mode: 'sa_key', secretCiphertext: encryptSecret(DUMMY_SA, keyFromBase64(config.SECRETS_KEY!)),
      metadata: { defaultGcpProjectId: 'acme-prod' }, createdByUserId: 'u-owner',
    });

    // 'web' project must not be able to bind it.
    const put = await inject('PUT', '/api/org/projects/web/gcp/connection', { connectionId: owned.id });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toMatch(/not available to this project/i);

    // And it must not appear in 'web' project's visible connections.
    const visible = await inject('GET', '/api/org/projects/web/gcp/connections');
    expect(visible.json().connections.some((c: { id: string }) => c.id === owned.id)).toBe(false);
  });
});
