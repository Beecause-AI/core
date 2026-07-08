import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, type GrafanaClient } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

const stubGrafanaClient: GrafanaClient = {
  async getOrg() { return { name: 'Acme' }; },
  async listDatasources() {
    return [
      { uid: 'prom1', name: 'Prometheus', type: 'prometheus' },
      { uid: 'loki1', name: 'Loki', type: 'loki' },
      { uid: 'maria', name: 'Maria', type: 'mysql' },
    ];
  },
  async queryMetrics() { return {}; },
  async queryLogs() { return {}; },
  async searchTraces() { return {}; },
  async getTrace() { return {}; },
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, grafanaClient: stubGrafanaClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

const createOrgConnection = async (name = 'Prod') => {
  const res = await inject('POST', '/api/integrations/grafana/connections', { name, baseUrl: 'https://grafana.acme.io/', token: 'glsa_secret_token' });
  expect(res.statusCode).toBe(200);
  return res.json().connection as { id: string; baseUrl: string; secretHint: string };
};

describe('org Grafana connections (org admin)', () => {
  it('creates a connection, normalizes baseUrl, never leaks the secret', async () => {
    const conn = await createOrgConnection('Prod SA');
    expect(conn.baseUrl).toBe('https://grafana.acme.io');
    expect(conn.secretHint).toBe('…oken');
    expect(JSON.stringify(conn)).not.toContain('glsa_secret_token');
  });

  it('verify discovers datasources and persists metrics+logs signals (drops mysql)', async () => {
    const conn = await createOrgConnection('Verify me');
    const res = await inject('POST', `/api/integrations/grafana/connections/${conn.id}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[]; datasources: { uid: string }[]; report: Record<string, { ok: boolean }> };
    expect(new Set(body.availableSignals)).toEqual(new Set(['metrics', 'logs']));
    expect(body.datasources.map((d) => d.uid)).toEqual(['prom1', 'loki1']);
    expect(body.report['traces']?.ok).toBe(false);
  });
});

describe('project-level Grafana connections (project admin)', () => {
  it('creates a project-owned connection and auto-binds it; not org-shared', async () => {
    const res = await inject('POST', '/api/org/projects/web/grafana/connections', { name: 'Project conn', baseUrl: 'https://g.io', token: 'glsa_proj' });
    expect(res.statusCode).toBe(200);
    const conn = res.json().connection as { id: string; projectId: string | null };
    expect(conn.projectId).not.toBeNull();

    const bound = await inject('GET', '/api/org/projects/web/grafana/connection');
    expect(bound.json().connection.id).toBe(conn.id);

    const orgList = await inject('GET', '/api/integrations/grafana/connections');
    expect(orgList.json().connections.some((c: { id: string }) => c.id === conn.id)).toBe(false);
  });

  it('adds a datasource to the scope and dedupes', async () => {
    await inject('POST', '/api/org/projects/web/grafana/connections', { name: 'C', baseUrl: 'https://g.io', token: 'glsa_x' });
    const add = await inject('POST', '/api/org/projects/web/grafana/targets', { datasourceUid: 'prom1', datasourceType: 'prometheus', name: 'Prometheus' });
    expect(add.statusCode).toBe(200);
    const dup = await inject('POST', '/api/org/projects/web/grafana/targets', { datasourceUid: 'prom1', datasourceType: 'prometheus', name: 'Prometheus' });
    expect(dup.statusCode).toBe(409);
  });

  it('deletes a project-owned connection and unbinds it', async () => {
    const bound = await inject('GET', '/api/org/projects/web/grafana/connection');
    const id = bound.json().connection.id as string;
    const del = await inject('DELETE', `/api/org/projects/web/grafana/connections/${id}`);
    expect(del.statusCode).toBe(204);
    expect((await inject('GET', '/api/org/projects/web/grafana/connection')).json().connection).toBeNull();
  });

  it('refuses to delete an org-shared connection via the project endpoint', async () => {
    const shared = await createOrgConnection('Org shared');
    const res = await inject('DELETE', `/api/org/projects/web/grafana/connections/${shared.id}`);
    expect(res.statusCode).toBe(404);
  });
});
