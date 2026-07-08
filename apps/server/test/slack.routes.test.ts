import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createOrgWithOwner, activateOrg } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import type { SlackClient } from '@intellilabs/core';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
  SLACK_CLIENT_ID: 'cid-123',
  SLACK_CLIENT_SECRET: 'csecret-123',
  SLACK_SIGNING_SECRET: 'sign-123',
  INTEGRATION_STATE_SECRET: 'k'.repeat(40),
};

const fakeSlack: SlackClient = {
  async oauthAccess({ code }) {
    return code.includes('bad')
      ? { ok: false, error: 'invalid_code' }
      : { ok: true, botToken: 'xoxb-good', teamId: 'T1', teamName: 'Acme HQ', botUserId: 'U999', scope: 'app_mentions:read,chat:write' };
  },
  async authTest(token) {
    return token.includes('bad')
      ? { ok: false, error: 'invalid_auth' }
      : { ok: true, teamId: 'T1', teamName: 'Acme HQ', botUserId: 'U999' };
  },
  async chatPostMessage(_token, _input) { return { ok: true, ts: '0.0' }; },
  async chatUpdate(_token, _input) { return { ok: true, ts: '0.0' }; },
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;
let userCookie: Record<string, string>;
let projectId: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api, slackClient: fakeSlack });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id); // host routing (resolveOrg) requires status==='active'
  const memberId = `${org.id}_u-user`;
  await t.store.db.collection('org_members').doc(memberId).set({ id: memberId, orgId: org.id, userId: 'u-user', role: 'user', createdAt: new Date() });
  // The /slack/channels route validates projectId as a UUID; seed with an explicit uuid doc id.
  projectId = randomUUID();
  await t.store.db.collection('projects').doc(projectId).set({
    id: projectId, orgId: org.id, name: 'P', slug: 'p', description: '',
    approvalPolicy: null, activeProposalId: null, createdAt: new Date(), updatedAt: new Date(),
  });
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-user', email: 'user@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const get = (url: string, cookies = ownerCookie) => app.inject({ method: 'GET', url, cookies, headers: ACM_HOST });
const del = (cookies = ownerCookie) => app.inject({ method: 'DELETE', url: '/api/slack/connection', cookies, headers: ACM_HOST });
const putCustom = (payload: Record<string, unknown>, cookies = ownerCookie) =>
  app.inject({ method: 'PUT', url: '/api/slack/connection/custom-app', cookies, headers: ACM_HOST, payload });

describe('GET /api/slack/connection', () => {
  it('returns null before any connection', async () => {
    const res = await get('/api/slack/connection');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('rejects a non-admin member (404)', async () => {
    const res = await get('/api/slack/connection', userCookie);
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/slack/connection', () => {
  it('is idempotent (204) when nothing is connected', async () => {
    const res = await del();
    expect(res.statusCode).toBe(204);
  });
});

describe('PUT /api/slack/connection/custom-app', () => {
  it('stores a valid custom app (201); never leaks token or signing secret', async () => {
    const res = await putCustom({ botToken: 'xoxb-good', signingSecret: 'shh-signing' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ provider: 'slack', mode: 'custom_app', accountLabel: 'Acme HQ', secretHint: '…good' });
    expect(body.secretCiphertext).toBeUndefined();
    expect(body.metadata.teamId).toBe('T1');
    expect(body.metadata.signingSecretCiphertext).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('xoxb-good');
    expect(JSON.stringify(body)).not.toContain('shh-signing');
    await del();
  });

  it('rejects a bad token (400)', async () => {
    const res = await putCustom({ botToken: 'xoxb-bad', signingSecret: 's' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing fields (400)', async () => {
    const res = await putCustom({ botToken: 'xoxb-good' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/slack/install-url', () => {
  it('mints a Slack authorize URL with state, scopes, and redirect_uri', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/slack/install-url', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const u = new URL(res.json().url);
    expect(u.origin + u.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid-123');
    expect(u.searchParams.get('scope')).toBe('app_mentions:read,chat:write');
    expect(u.searchParams.get('redirect_uri')).toBe('https://beecause.ai/api/slack/oauth/callback');
    expect(u.searchParams.get('state')).toBeTruthy();
  });
});

describe('GET /api/slack/oauth/callback', () => {
  it('completes the install and connects the org, then redirects to the org admin page', async () => {
    const urlRes = await app.inject({ method: 'POST', url: '/api/slack/install-url', cookies: ownerCookie, headers: ACM_HOST });
    const state = new URL(urlRes.json().url).searchParams.get('state')!;

    const cb = await app.inject({ method: 'GET', url: `/api/slack/oauth/callback?code=good-code&state=${encodeURIComponent(state)}` });
    expect([301, 302]).toContain(cb.statusCode);
    expect(cb.headers.location).toBe('https://acme.beecause.ai/admin/slack?connected=1');

    const conn = (await get('/api/slack/connection')).json();
    expect(conn).toMatchObject({ provider: 'slack', mode: 'oauth', accountLabel: 'Acme HQ' });
    expect(conn.metadata.teamId).toBe('T1');
    expect(conn.metadata.botUserId).toBe('U999');
    await del();
  });

  it('rejects a replayed state (already consumed)', async () => {
    const urlRes = await app.inject({ method: 'POST', url: '/api/slack/install-url', cookies: ownerCookie, headers: ACM_HOST });
    const state = new URL(urlRes.json().url).searchParams.get('state')!;
    await app.inject({ method: 'GET', url: `/api/slack/oauth/callback?code=good-code&state=${encodeURIComponent(state)}` });
    const replay = await app.inject({ method: 'GET', url: `/api/slack/oauth/callback?code=good-code&state=${encodeURIComponent(state)}` });
    expect(replay.statusCode).toBe(400);
    await del();
  });

  it('redirects with ?error when Slack rejects the code', async () => {
    const urlRes = await app.inject({ method: 'POST', url: '/api/slack/install-url', cookies: ownerCookie, headers: ACM_HOST });
    const state = new URL(urlRes.json().url).searchParams.get('state')!;
    const cb = await app.inject({ method: 'GET', url: `/api/slack/oauth/callback?code=bad-code&state=${encodeURIComponent(state)}` });
    expect([301, 302]).toContain(cb.statusCode);
    expect(cb.headers.location).toContain('/admin/slack?error=invalid_code');
  });

  it('rejects an invalid state (400)', async () => {
    const cb = await app.inject({ method: 'GET', url: `/api/slack/oauth/callback?code=good-code&state=garbage` });
    expect(cb.statusCode).toBe(400);
  });
});

describe('POST /api/slack/connection/test', () => {
  it('returns ok:true and marks tested after a custom-app connect', async () => {
    await putCustom({ botToken: 'xoxb-good', signingSecret: 's' });
    const res = await app.inject({ method: 'POST', url: '/api/slack/connection/test', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    const conn = (await get('/api/slack/connection')).json();
    expect(conn.lastTestOk).toBe(true);
    await del();
  });

  it('returns 404 when nothing is connected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/slack/connection/test', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});

describe('slack channel bindings CRUD', () => {
  it('list/create/delete bindings', async () => {
    await putCustom({ botToken: 'xoxb-good', signingSecret: 's' });   // connect → creates the org's slack integration
    const create = await app.inject({ method: 'POST', url: '/api/slack/channels', cookies: ownerCookie, headers: ACM_HOST, payload: { channelId: 'C5', projectId } });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ slackChannelId: 'C5', status: 'bound' });

    const list = await app.inject({ method: 'GET', url: '/api/slack/channels', cookies: ownerCookie, headers: ACM_HOST });
    expect(list.json().some((b: any) => b.slackChannelId === 'C5')).toBe(true);

    const del2 = await app.inject({ method: 'DELETE', url: '/api/slack/channels/C5', cookies: ownerCookie, headers: ACM_HOST });
    expect(del2.statusCode).toBe(204);
    await del();   // disconnect the slack integration (existing helper)
  });

  it('rejects a non-admin (404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/slack/channels', cookies: userCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});
