import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, makeDynatraceClientForTest } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

const stubDynatraceClient = makeDynatraceClientForTest({
  validate: async () => {},
  listMetrics: async () => ({ data: [] }),
  searchLogs: async () => ({ data: [] }),
  listProblems: async () => ({ problems: [] }),
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, dynatraceClient: stubDynatraceClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

describe('Dynatrace connections + scope routes', () => {
  let connId: string;

  it('creates an api_token connection, returns secretHint, never leaks the secret', async () => {
    const res = await inject('POST', '/api/integrations/dynatrace/connections', {
      name: 'prod', environmentUrl: 'https://abc123.live.dynatrace.com', apiToken: 'dt0c01.ABCDEF.wxyz',
    });
    expect(res.statusCode).toBe(200);
    const conn = res.json().connection;
    expect(conn.secretHint).toBe('…wxyz');
    expect(JSON.stringify(conn)).not.toContain('apiToken');
    expect(JSON.stringify(conn)).not.toContain('secretCiphertext');
    connId = conn.id;
  });

  it('rejects a non-url environmentUrl with 400', async () => {
    const res = await inject('POST', '/api/integrations/dynatrace/connections', {
      name: 'bad', environmentUrl: 'not-a-url', apiToken: 'dt0c01.TOKEN.abcd',
    });
    expect(res.statusCode).toBe(400);
  });

  it('verifies the connection, returns availableSignals including problems (all three signals ok with fake client)', async () => {
    const res = await inject('POST', `/api/integrations/dynatrace/connections/${connId}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[] };
    expect(body.availableSignals.sort()).toEqual(['logs', 'metrics', 'problems']);
    expect(body.availableSignals).toContain('problems');
  });

  it('lists connections without secrets', async () => {
    const res = await inject('GET', '/api/integrations/dynatrace/connections');
    expect(res.statusCode).toBe(200);
    const { connections } = res.json() as { connections: { id: string }[] };
    expect(connections.some((c) => c.id === connId)).toBe(true);
    expect(JSON.stringify(connections)).not.toContain('secretCiphertext');
  });

  it('patches a connection name', async () => {
    const res = await inject('PATCH', `/api/integrations/dynatrace/connections/${connId}`, { name: 'prod-updated' });
    expect(res.statusCode).toBe(200);
    expect(res.json().connection.name).toBe('prod-updated');
  });

  it('adds a target to a project and lists it', async () => {
    const add = await inject('POST', '/api/org/projects/web/dynatrace/targets', {
      connectionId: connId, managementZone: 'production', service: 'checkout', label: 'production checkout',
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().target.managementZone).toBe('production');
    expect(add.json().target.service).toBe('checkout');

    const list = await inject('GET', '/api/org/projects/web/dynatrace/targets');
    expect(list.statusCode).toBe(200);
    const { targets } = list.json() as { targets: { managementZone: string; service: string }[] };
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ managementZone: 'production', service: 'checkout' });
  });

  it('rejects a duplicate (managementZone, service) target', async () => {
    const res = await inject('POST', '/api/org/projects/web/dynatrace/targets', {
      connectionId: connId, managementZone: 'production', service: 'checkout',
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a target with an unavailable connectionId', async () => {
    const res = await inject('POST', '/api/org/projects/web/dynatrace/targets', {
      connectionId: 'nonexistent-conn', managementZone: 'staging',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a target with neither managementZone nor service', async () => {
    const res = await inject('POST', '/api/org/projects/web/dynatrace/targets', {
      connectionId: connId, label: 'missing-scope',
    });
    expect(res.statusCode).toBe(400);
  });

  describe('project-level connection create/delete', () => {
    let projConnId: string;

    it('creates a project-private connection and it appears in project list but NOT org list', async () => {
      const res = await inject('POST', '/api/org/projects/web/dynatrace/connections', {
        name: 'proj-prod', environmentUrl: 'https://proj123.live.dynatrace.com', apiToken: 'dt0c01.PROJ.efgh',
      });
      expect(res.statusCode).toBe(200);
      const conn = res.json().connection;
      expect(conn.name).toBe('proj-prod');
      projConnId = conn.id;

      // Should appear in project list
      const projList = await inject('GET', '/api/org/projects/web/dynatrace/connections');
      expect(projList.statusCode).toBe(200);
      const { connections: projConns } = projList.json() as { connections: { id: string }[] };
      expect(projConns.some((c) => c.id === projConnId)).toBe(true);

      // Should NOT appear in org list (org list is projectId==null only)
      const orgList = await inject('GET', '/api/integrations/dynatrace/connections');
      expect(orgList.statusCode).toBe(200);
      const { connections: orgConns } = orgList.json() as { connections: { id: string }[] };
      expect(orgConns.some((c) => c.id === projConnId)).toBe(false);

      // projectId should be exposed in the public shape
      expect(conn.projectId).toBeDefined();
    });

    it('deletes a project-owned connection via the project route → 204, then gone', async () => {
      const del = await inject('DELETE', `/api/org/projects/web/dynatrace/connections/${projConnId}`);
      expect(del.statusCode).toBe(204);

      const projList = await inject('GET', '/api/org/projects/web/dynatrace/connections');
      const { connections } = projList.json() as { connections: { id: string }[] };
      expect(connections.some((c) => c.id === projConnId)).toBe(false);
    });

    it('refuses to delete an org-shared connection via the project route → 404', async () => {
      // connId is the org-level connection created in the outer describe
      const res = await inject('DELETE', `/api/org/projects/web/dynatrace/connections/${connId}`);
      expect(res.statusCode).toBe(404);
    });

    it('deletes a project-owned connection and its orphan targets are cleaned up', async () => {
      // 1. Create a new project-private connection
      const createRes = await inject('POST', '/api/org/projects/web/dynatrace/connections', {
        name: 'orphan-test', environmentUrl: 'https://orphan123.live.dynatrace.com', apiToken: 'dt0c01.ORPHAN.5678',
      });
      expect(createRes.statusCode).toBe(200);
      const orphanConnId: string = createRes.json().connection.id;

      // 2. Add a target referencing this connection
      const addRes = await inject('POST', '/api/org/projects/web/dynatrace/targets', {
        connectionId: orphanConnId, managementZone: 'staging', service: 'payments',
      });
      expect(addRes.statusCode).toBe(200);

      // Confirm the target is listed
      const listBefore = await inject('GET', '/api/org/projects/web/dynatrace/targets');
      expect(listBefore.statusCode).toBe(200);
      const { targets: targetsBefore } = listBefore.json() as { targets: { connectionId: string }[] };
      expect(targetsBefore.some((t) => t.connectionId === orphanConnId)).toBe(true);

      // 3. Delete the connection
      const delRes = await inject('DELETE', `/api/org/projects/web/dynatrace/connections/${orphanConnId}`);
      expect(delRes.statusCode).toBe(204);

      // 4. Assert orphan cleanup: the target referencing this connection must be gone
      const listAfter = await inject('GET', '/api/org/projects/web/dynatrace/targets');
      expect(listAfter.statusCode).toBe(200);
      const { targets: targetsAfter } = listAfter.json() as { targets: { connectionId: string }[] };
      expect(targetsAfter.every((t) => t.connectionId !== orphanConnId)).toBe(true);
    });
  });

  it('verify from project scope persists availableSignals', async () => {
    const res = await inject('POST', `/api/org/projects/web/dynatrace/connections/${connId}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[] };
    expect(body.availableSignals.sort()).toEqual(['logs', 'metrics', 'problems']);
  });

  describe('verify failure path — persists lastTestOk=false without wiping availableSignals', () => {
    let failConnId: string;

    it('seed: create connection, verify once (all signals ok) via a working client', async () => {
      const create = await inject('POST', '/api/integrations/dynatrace/connections', {
        name: 'fail-verify-test', environmentUrl: 'https://fail123.live.dynatrace.com', apiToken: 'dt0c01.FAIL.5678',
      });
      expect(create.statusCode).toBe(200);
      failConnId = create.json().connection.id;

      // First verify with the default stub (all 3 signals ok) to seed availableSignals.
      const verify = await inject('POST', `/api/integrations/dynatrace/connections/${failConnId}/verify`);
      expect(verify.statusCode).toBe(200);
      expect(verify.json().availableSignals.sort()).toEqual(['logs', 'metrics', 'problems']);
    });

    it('verify failure: 502, lastTestOk=false, availableSignals preserved (not wiped)', async () => {
      // Build a throwing client and a new app that uses it.
      const throwingClient = makeDynatraceClientForTest({
        validate: async () => { throw new Error('transient network error'); },
      });
      const throwingApp = await buildApp({ db: t.db, store: t.store, config, dynatraceClient: throwingClient });

      const res = await throwingApp.inject({
        method: 'POST',
        url: `/api/integrations/dynatrace/connections/${failConnId}/verify`,
        cookies: ownerCookie,
        headers: ACM_HOST,
      });

      // (a) 502
      expect(res.statusCode).toBe(502);

      // Read back the connection from the shared DB to inspect persisted state.
      const list = await inject('GET', '/api/integrations/dynatrace/connections');
      const { connections } = list.json() as { connections: { id: string; lastTestOk: boolean | null; metadata: { availableSignals?: string[] } }[] };
      const updated = connections.find((c) => c.id === failConnId);
      expect(updated).toBeDefined();

      // (b) lastTestOk persisted as false
      expect(updated!.lastTestOk).toBe(false);

      // (c) availableSignals NOT wiped — still the 3 signals from the seed verify
      expect(updated!.metadata.availableSignals?.sort()).toEqual(['logs', 'metrics', 'problems']);

      await throwingApp.close();
    });
  });

  it('deletes a target → 204, then gone', async () => {
    // First list targets to get the id
    const list = await inject('GET', '/api/org/projects/web/dynatrace/targets');
    const { targets } = list.json() as { targets: { id: string; managementZone: string }[] };
    const prodTarget = targets.find((t) => t.managementZone === 'production');
    expect(prodTarget).toBeDefined();

    const del = await inject('DELETE', `/api/org/projects/web/dynatrace/targets/${prodTarget!.id}`);
    expect(del.statusCode).toBe(204);

    const listAfter = await inject('GET', '/api/org/projects/web/dynatrace/targets');
    const { targets: targetsAfter } = listAfter.json() as { targets: { id: string }[] };
    expect(targetsAfter.every((t) => t.id !== prodTarget!.id)).toBe(true);
  });

  it('deletes an org connection → 204', async () => {
    const res = await inject('DELETE', `/api/integrations/dynatrace/connections/${connId}`);
    expect(res.statusCode).toBe(204);

    const list = await inject('GET', '/api/integrations/dynatrace/connections');
    const { connections } = list.json() as { connections: { id: string }[] };
    expect(connections.every((c) => c.id !== connId)).toBe(true);
  });
});
