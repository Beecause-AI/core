import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, makeAzureClientForTest } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

const stubAzureClient = makeAzureClientForTest({
  checkCredential: async () => {},
  queryLogs: async () => ({ status: 'Success', tables: [] }),
  listAlerts: async () => ({ alerts: [] }),
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, azureClient: stubAzureClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

describe('Azure connections + scope routes', () => {
  let connId: string;

  it('creates a service_principal connection, returns secretHint, never leaks the secret', async () => {
    const res = await inject('POST', '/api/integrations/azure/connections', {
      name: 'prod', mode: 'service_principal', tenantId: 'tenant-1', clientId: 'app-abcd',
      clientSecret: 'secret', defaultSubscriptionId: 'sub-1', defaultWorkspaceId: 'ws-1',
    });
    expect(res.statusCode).toBe(200);
    const conn = res.json().connection;
    expect(conn.secretHint).toBe('…abcd');
    expect(JSON.stringify(conn)).not.toContain('clientSecret');
    expect(JSON.stringify(conn)).not.toContain('secretCiphertext');
    connId = conn.id;
  });

  it('verifies the connection, returns availableSignals (all four signals ok with fake client)', async () => {
    const res = await inject('POST', `/api/integrations/azure/connections/${connId}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[] };
    expect(body.availableSignals.sort()).toEqual(['alerts', 'logs', 'metrics', 'traces']);
  });

  it('adds a target to a project and lists it', async () => {
    const add = await inject('POST', '/api/org/projects/web/azure/targets', {
      connectionId: connId, subscriptionId: 'sub-1', workspaceId: 'ws-1', label: 'prod',
    });
    expect(add.statusCode).toBe(200);

    const list = await inject('GET', '/api/org/projects/web/azure/targets');
    expect(list.statusCode).toBe(200);
    const { targets } = list.json() as { targets: { subscriptionId: string; logAnalyticsWorkspaceId: string }[] };
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ subscriptionId: 'sub-1', logAnalyticsWorkspaceId: 'ws-1' });
  });

  describe('project-level connection create/delete', () => {
    let projConnId: string;

    it('creates a project-private connection and it appears in project list but NOT org list', async () => {
      const res = await inject('POST', '/api/org/projects/web/azure/connections', {
        name: 'proj-prod', mode: 'service_principal', tenantId: 'tenant-1', clientId: 'app-efgh',
        clientSecret: 'proj-secret', defaultSubscriptionId: 'sub-2',
      });
      expect(res.statusCode).toBe(200);
      const conn = res.json().connection;
      expect(conn.name).toBe('proj-prod');
      projConnId = conn.id;

      // Should appear in project list
      const projList = await inject('GET', '/api/org/projects/web/azure/connections');
      expect(projList.statusCode).toBe(200);
      const { connections: projConns } = projList.json() as { connections: { id: string }[] };
      expect(projConns.some((c) => c.id === projConnId)).toBe(true);

      // Should NOT appear in org list (org list is projectId==null only)
      const orgList = await inject('GET', '/api/integrations/azure/connections');
      expect(orgList.statusCode).toBe(200);
      const { connections: orgConns } = orgList.json() as { connections: { id: string }[] };
      expect(orgConns.some((c) => c.id === projConnId)).toBe(false);

      // projectId should be exposed in the public shape
      expect(conn.projectId).toBeDefined();
    });

    it('deletes a project-owned connection via the project route → 204, then gone', async () => {
      const del = await inject('DELETE', `/api/org/projects/web/azure/connections/${projConnId}`);
      expect(del.statusCode).toBe(204);

      const projList = await inject('GET', '/api/org/projects/web/azure/connections');
      const { connections } = projList.json() as { connections: { id: string }[] };
      expect(connections.some((c) => c.id === projConnId)).toBe(false);
    });

    it('refuses to delete an org-shared connection via the project route → 404', async () => {
      // connId is the org-level connection created in the outer describe
      const res = await inject('DELETE', `/api/org/projects/web/azure/connections/${connId}`);
      expect(res.statusCode).toBe(404);
    });

    it('deletes a project-owned connection and its orphan targets are cleaned up', async () => {
      // 1. Create a new project-private connection
      const createRes = await inject('POST', '/api/org/projects/web/azure/connections', {
        name: 'orphan-test', mode: 'service_principal', tenantId: 'tenant-1', clientId: 'app-ijkl',
        clientSecret: 'orphan-secret', defaultSubscriptionId: 'sub-3', defaultWorkspaceId: 'ws-3',
      });
      expect(createRes.statusCode).toBe(200);
      const orphanConnId: string = createRes.json().connection.id;

      // 2. Add a target referencing this connection
      const addRes = await inject('POST', '/api/org/projects/web/azure/targets', {
        connectionId: orphanConnId, subscriptionId: 'sub-3', workspaceId: 'ws-3',
      });
      expect(addRes.statusCode).toBe(200);

      // Confirm the target is listed
      const listBefore = await inject('GET', '/api/org/projects/web/azure/targets');
      expect(listBefore.statusCode).toBe(200);
      const { targets: targetsBefore } = listBefore.json() as { targets: { connectionId: string }[] };
      expect(targetsBefore.some((t) => t.connectionId === orphanConnId)).toBe(true);

      // 3. Delete the connection
      const delRes = await inject('DELETE', `/api/org/projects/web/azure/connections/${orphanConnId}`);
      expect(delRes.statusCode).toBe(204);

      // 4. Assert orphan cleanup: the target referencing this connection must be gone
      const listAfter = await inject('GET', '/api/org/projects/web/azure/targets');
      expect(listAfter.statusCode).toBe(200);
      const { targets: targetsAfter } = listAfter.json() as { targets: { connectionId: string }[] };
      expect(targetsAfter.every((t) => t.connectionId !== orphanConnId)).toBe(true);
    });
  });
});
