import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, makeDatadogClientForTest } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

const stubDatadogClient = makeDatadogClientForTest({
  validate: async () => {},
  listMetrics: async () => ({ data: [] }),
  searchLogs: async () => ({ data: [] }),
  searchSpans: async () => ({ data: [] }),
  listMonitors: async () => [],
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, datadogClient: stubDatadogClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

describe('Datadog connections + scope routes', () => {
  let connId: string;

  it('creates an api_keys connection, returns secretHint, never leaks the secret', async () => {
    const res = await inject('POST', '/api/integrations/datadog/connections', {
      name: 'prod', site: 'us1', apiKey: 'ak-abcdef', appKey: 'app-wxyz',
    });
    expect(res.statusCode).toBe(200);
    const conn = res.json().connection;
    expect(conn.secretHint).toBe('…wxyz');
    expect(JSON.stringify(conn)).not.toContain('apiKey');
    expect(JSON.stringify(conn)).not.toContain('secretCiphertext');
    connId = conn.id;
  });

  it('verifies the connection, returns availableSignals (all four signals ok with fake client)', async () => {
    const res = await inject('POST', `/api/integrations/datadog/connections/${connId}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[] };
    expect(body.availableSignals.sort()).toEqual(['alerts', 'logs', 'metrics', 'traces']);
  });

  it('lists connections without secrets', async () => {
    const res = await inject('GET', '/api/integrations/datadog/connections');
    expect(res.statusCode).toBe(200);
    const { connections } = res.json() as { connections: { id: string }[] };
    expect(connections.some((c) => c.id === connId)).toBe(true);
    expect(JSON.stringify(connections)).not.toContain('secretCiphertext');
  });

  it('patches a connection name', async () => {
    const res = await inject('PATCH', `/api/integrations/datadog/connections/${connId}`, { name: 'prod-updated' });
    expect(res.statusCode).toBe(200);
    expect(res.json().connection.name).toBe('prod-updated');
  });

  it('adds a target to a project and lists it', async () => {
    const add = await inject('POST', '/api/org/projects/web/datadog/targets', {
      connectionId: connId, env: 'prod', service: 'checkout', label: 'production checkout',
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().target.env).toBe('prod');
    expect(add.json().target.service).toBe('checkout');

    const list = await inject('GET', '/api/org/projects/web/datadog/targets');
    expect(list.statusCode).toBe(200);
    const { targets } = list.json() as { targets: { env: string; service: string }[] };
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ env: 'prod', service: 'checkout' });
  });

  it('rejects a duplicate (env, service) target', async () => {
    const res = await inject('POST', '/api/org/projects/web/datadog/targets', {
      connectionId: connId, env: 'prod', service: 'checkout',
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a target with an unavailable connectionId', async () => {
    const res = await inject('POST', '/api/org/projects/web/datadog/targets', {
      connectionId: 'nonexistent-conn', env: 'staging',
    });
    expect(res.statusCode).toBe(400);
  });

  describe('project-level connection create/delete', () => {
    let projConnId: string;

    it('creates a project-private connection and it appears in project list but NOT org list', async () => {
      const res = await inject('POST', '/api/org/projects/web/datadog/connections', {
        name: 'proj-prod', site: 'eu', apiKey: 'ak-proj-abcd', appKey: 'app-proj-efgh',
      });
      expect(res.statusCode).toBe(200);
      const conn = res.json().connection;
      expect(conn.name).toBe('proj-prod');
      projConnId = conn.id;

      // Should appear in project list
      const projList = await inject('GET', '/api/org/projects/web/datadog/connections');
      expect(projList.statusCode).toBe(200);
      const { connections: projConns } = projList.json() as { connections: { id: string }[] };
      expect(projConns.some((c) => c.id === projConnId)).toBe(true);

      // Should NOT appear in org list (org list is projectId==null only)
      const orgList = await inject('GET', '/api/integrations/datadog/connections');
      expect(orgList.statusCode).toBe(200);
      const { connections: orgConns } = orgList.json() as { connections: { id: string }[] };
      expect(orgConns.some((c) => c.id === projConnId)).toBe(false);

      // projectId should be exposed in the public shape
      expect(conn.projectId).toBeDefined();
    });

    it('deletes a project-owned connection via the project route → 204, then gone', async () => {
      const del = await inject('DELETE', `/api/org/projects/web/datadog/connections/${projConnId}`);
      expect(del.statusCode).toBe(204);

      const projList = await inject('GET', '/api/org/projects/web/datadog/connections');
      const { connections } = projList.json() as { connections: { id: string }[] };
      expect(connections.some((c) => c.id === projConnId)).toBe(false);
    });

    it('refuses to delete an org-shared connection via the project route → 404', async () => {
      // connId is the org-level connection created in the outer describe
      const res = await inject('DELETE', `/api/org/projects/web/datadog/connections/${connId}`);
      expect(res.statusCode).toBe(404);
    });

    it('deletes a project-owned connection and its orphan targets are cleaned up', async () => {
      // 1. Create a new project-private connection
      const createRes = await inject('POST', '/api/org/projects/web/datadog/connections', {
        name: 'orphan-test', site: 'us3', apiKey: 'ak-orphan-1234', appKey: 'app-orphan-5678',
      });
      expect(createRes.statusCode).toBe(200);
      const orphanConnId: string = createRes.json().connection.id;

      // 2. Add a target referencing this connection
      const addRes = await inject('POST', '/api/org/projects/web/datadog/targets', {
        connectionId: orphanConnId, env: 'staging', service: 'payments',
      });
      expect(addRes.statusCode).toBe(200);

      // Confirm the target is listed
      const listBefore = await inject('GET', '/api/org/projects/web/datadog/targets');
      expect(listBefore.statusCode).toBe(200);
      const { targets: targetsBefore } = listBefore.json() as { targets: { connectionId: string }[] };
      expect(targetsBefore.some((t) => t.connectionId === orphanConnId)).toBe(true);

      // 3. Delete the connection
      const delRes = await inject('DELETE', `/api/org/projects/web/datadog/connections/${orphanConnId}`);
      expect(delRes.statusCode).toBe(204);

      // 4. Assert orphan cleanup: the target referencing this connection must be gone
      const listAfter = await inject('GET', '/api/org/projects/web/datadog/targets');
      expect(listAfter.statusCode).toBe(200);
      const { targets: targetsAfter } = listAfter.json() as { targets: { connectionId: string }[] };
      expect(targetsAfter.every((t) => t.connectionId !== orphanConnId)).toBe(true);
    });
  });

  it('verify from project scope persists availableSignals', async () => {
    const res = await inject('POST', `/api/org/projects/web/datadog/connections/${connId}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[] };
    expect(body.availableSignals.sort()).toEqual(['alerts', 'logs', 'metrics', 'traces']);
  });

  describe('verify failure path — persists lastTestOk=false without wiping availableSignals', () => {
    let failConnId: string;

    it('seed: create connection, verify once (signals=["metrics"]) via a working client', async () => {
      // Create a separate connection to isolate from the main connId used by other tests.
      const create = await inject('POST', '/api/integrations/datadog/connections', {
        name: 'fail-verify-test', site: 'us1', apiKey: 'ak-fail-1234', appKey: 'app-fail-5678',
      });
      expect(create.statusCode).toBe(200);
      failConnId = create.json().connection.id;

      // First verify with the default stub (all 4 signals ok) to seed availableSignals.
      const verify = await inject('POST', `/api/integrations/datadog/connections/${failConnId}/verify`);
      expect(verify.statusCode).toBe(200);
      expect(verify.json().availableSignals.sort()).toEqual(['alerts', 'logs', 'metrics', 'traces']);
    });

    it('verify failure: 502, lastTestOk=false, availableSignals preserved (not wiped)', async () => {
      // Build a throwing client and a new app that uses it.
      const throwingClient = makeDatadogClientForTest({
        validate: async () => { throw new Error('transient network error'); },
      });
      const throwingApp = await buildApp({ db: t.db, store: t.store, config, datadogClient: throwingClient });

      const res = await throwingApp.inject({
        method: 'POST',
        url: `/api/integrations/datadog/connections/${failConnId}/verify`,
        cookies: ownerCookie,
        headers: ACM_HOST,
      });

      // (a) 502
      expect(res.statusCode).toBe(502);

      // Read back the connection from the shared DB to inspect persisted state.
      const list = await inject('GET', '/api/integrations/datadog/connections');
      const { connections } = list.json() as { connections: { id: string; lastTestOk: boolean | null; metadata: { availableSignals?: string[] } }[] };
      const updated = connections.find((c) => c.id === failConnId);
      expect(updated).toBeDefined();

      // (b) lastTestOk persisted as false
      expect(updated!.lastTestOk).toBe(false);

      // (c) availableSignals NOT wiped — still the 4 signals from the seed verify
      expect(updated!.metadata.availableSignals?.sort()).toEqual(['alerts', 'logs', 'metrics', 'traces']);

      await throwingApp.close();
    });
  });

  it('deletes a target → 204, then gone', async () => {
    // First list targets to get the id
    const list = await inject('GET', '/api/org/projects/web/datadog/targets');
    const { targets } = list.json() as { targets: { id: string; env: string }[] };
    const prodTarget = targets.find((t) => t.env === 'prod');
    expect(prodTarget).toBeDefined();

    const del = await inject('DELETE', `/api/org/projects/web/datadog/targets/${prodTarget!.id}`);
    expect(del.statusCode).toBe(204);

    const listAfter = await inject('GET', '/api/org/projects/web/datadog/targets');
    const { targets: targetsAfter } = listAfter.json() as { targets: { id: string }[] };
    expect(targetsAfter.every((t) => t.id !== prodTarget!.id)).toBe(true);
  });

  it('deletes an org connection → 204', async () => {
    const res = await inject('DELETE', `/api/integrations/datadog/connections/${connId}`);
    expect(res.statusCode).toBe(204);

    const list = await inject('GET', '/api/integrations/datadog/connections');
    const { connections } = list.json() as { connections: { id: string }[] };
    expect(connections.every((c) => c.id !== connId)).toBe(true);
  });
});
