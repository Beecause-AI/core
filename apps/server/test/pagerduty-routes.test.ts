import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, addProjectMember, makePagerDutyClientForTest } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

const stubPagerDutyClient = makePagerDutyClientForTest({
  validate: async () => {},
  listIncidents: async () => ({ incidents: [] }),
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, pagerdutyClient: stubPagerDutyClient });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  await addProjectMember(t.db, org.id, proj.id, 'u-owner', 'admin');
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, cookies: ownerCookie, headers: ACM_HOST, ...(payload ? { payload } : {}) });

describe('PagerDuty connections + scope routes', () => {
  let connId: string;

  it('rejects an unauthenticated list with 401/403, not 404 (route mounted)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/integrations/pagerduty/connections', headers: ACM_HOST });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('creates an api_keys connection, returns secretHint, never leaks the secret', async () => {
    const res = await inject('POST', '/api/integrations/pagerduty/connections', {
      name: 'prod', region: 'us', apiToken: 'pd-abcwxyz',
    });
    expect(res.statusCode).toBe(200);
    const conn = res.json().connection;
    expect(conn.secretHint).toBe('…wxyz');
    expect(JSON.stringify(conn)).not.toContain('apiToken');
    expect(JSON.stringify(conn)).not.toContain('secretCiphertext');
    connId = conn.id;
  });

  it('verifies the connection, returns availableSignals containing alerts', async () => {
    const res = await inject('POST', `/api/integrations/pagerduty/connections/${connId}/verify`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { availableSignals: string[] };
    expect(body.availableSignals).toContain('alerts');
  });

  it('400s on a malformed create body (empty name)', async () => {
    const res = await inject('POST', '/api/integrations/pagerduty/connections', { name: '' });
    expect(res.statusCode).toBe(400);
  });
});
