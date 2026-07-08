import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, createProject, upsertIntegration, encryptSecret, keyFromBase64, type SlackClient } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

// Confirms the in-Slack "Connect this channel" flow posts a confirmation back
// into the originating thread (only when a threadTs is supplied).

const HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') };

const posted: Array<{ channel: string; text: string; threadTs?: string }> = [];
const fakeSlack: SlackClient = {
  async oauthAccess() { return { ok: false, error: 'x' }; },
  async authTest() { return { ok: false, error: 'x' }; },
  async chatPostMessage(_token, m) { posted.push({ channel: m.channel, text: m.text, threadTs: m.threadTs }); return { ok: true, ts: 't.1' }; },
  async chatUpdate() { return { ok: true }; },
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, slackClient: fakeSlack });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id); // host routing (resolveOrg) requires status==='active'
  await createProject(t.db, org.id, { name: 'P1', slug: 'p1' });
  await upsertIntegration(t.db, {
    orgId: org.id, provider: 'slack', mode: 'oauth', accountLabel: 'Acme HQ',
    metadata: { teamId: 'T1' },
    secretCiphertext: encryptSecret('xoxb-test', keyFromBase64(config.SECRETS_KEY!)),
    connectedByUserId: 'u-owner', lastTestOk: true,
  });
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const claim = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/org/projects/p1/slack-channels', cookies: ownerCookie, headers: HOST, payload });

describe('Slack connect confirmation post', () => {
  it('posts a confirmation in the originating thread when threadTs is provided', async () => {
    posted.length = 0;
    const res = await claim({ channelId: 'C1', threadTs: '1700.0001' });
    expect(res.statusCode).toBe(201);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.channel).toBe('C1');
    expect(posted[0]!.threadTs).toBe('1700.0001');
    expect(posted[0]!.text).toContain('P1');
  });

  it('does not post when no threadTs (project-level assign)', async () => {
    posted.length = 0;
    const res = await claim({ channelId: 'C2' });
    expect(res.statusCode).toBe(201);
    expect(posted).toHaveLength(0);
  });
});
