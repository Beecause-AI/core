import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { createOrgWithOwner, upsertIntegration, getIntegration, searchCatalog } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret';
const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
  GITHUB_APP_SLUG: 'intellilabs-agent',
  GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let orgId: string;
let seededIntegrationId: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });
  orgId = org.id;
  await upsertIntegration(t.db, {
    orgId, provider: 'github', mode: 'agent_app', accountLabel: 'acme-corp',
    metadata: { installationId: '555', events: { issues: true, pullRequests: true, branches: false } }, lastTestOk: true,
  });
  const seeded = await getIntegration(t.db, orgId, 'github');
  seededIntegrationId = seeded!.id;
});
afterAll(async () => { await app.close(); await t.stop(); });

const sign = (raw: string) => 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
const deliver = (event: string, payload: object, delivery: string, opts: { sig?: string } = {}) => {
  const raw = JSON.stringify(payload);
  return app.inject({
    method: 'POST', url: '/api/github', payload: raw,
    headers: {
      'content-type': 'application/json', 'x-github-event': event,
      'x-github-delivery': delivery, 'x-hub-signature-256': opts.sig ?? sign(raw),
    },
  });
};
// deliveryId is the integration_events doc id (idempotency key), so read it directly.
const eventRows = async (deliveryId: string) => {
  const snap = await t.store.db.collection('integration_events').doc(deliveryId).get();
  return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
};

describe('signature & attribution', () => {
  it('rejects a bad signature (401), stores nothing', async () => {
    const res = await deliver('issues', { action: 'opened', installation: { id: 555 } }, 'd-bad', { sig: 'sha256=deadbeef' });
    expect(res.statusCode).toBe(401);
    expect((await eventRows('d-bad')).length).toBe(0);
  });
  it('acks an unknown installation (202), stores nothing', async () => {
    const res = await deliver('issues', { action: 'opened', installation: { id: 99999 } }, 'd-unknown');
    expect(res.statusCode).toBe(202);
    expect((await eventRows('d-unknown')).length).toBe(0);
  });
  it('200s a ping', async () => {
    const res = await deliver('ping', { zen: 'hi', installation: { id: 555 } }, 'd-ping');
    expect(res.statusCode).toBe(200);
  });
});

describe('storage, classification, mention, toggles, dedupe', () => {
  it('stores an issues.assigned event with action + repo + actor', async () => {
    const res = await deliver('issues',
      { action: 'assigned', installation: { id: 555 }, repository: { full_name: 'acme-corp/web' }, sender: { login: 'octocat' } }, 'd-1');
    expect(res.statusCode).toBe(200);
    expect((await eventRows('d-1'))[0]).toMatchObject({ category: 'issues', eventType: 'issues', action: 'assigned', repoFullName: 'acme-corp/web', actorLogin: 'octocat', mentionsBot: false });
  });

  it('flags mentionsBot on a PR comment that @-mentions the agent', async () => {
    await deliver('issue_comment',
      { action: 'created', installation: { id: 555 }, issue: { pull_request: {} }, comment: { body: 'hey @intellilabs-agent take a look' }, repository: { full_name: 'acme-corp/web' } }, 'd-2');
    expect((await eventRows('d-2'))[0]).toMatchObject({ category: 'pull_requests', mentionsBot: true });
  });

  it('drops a toggled-off category (branches=false → push not stored)', async () => {
    const res = await deliver('push', { installation: { id: 555 }, ref: 'refs/heads/main', repository: { full_name: 'acme-corp/web' } }, 'd-3');
    expect(res.statusCode).toBe(200);
    expect((await eventRows('d-3')).length).toBe(0);
  });

  it('dedupes a redelivered delivery id (one row only)', async () => {
    const payload = { action: 'opened', installation: { id: 555 }, repository: { full_name: 'acme-corp/web' } };
    await deliver('issues', payload, 'd-dup');
    await deliver('issues', payload, 'd-dup');
    expect((await eventRows('d-dup')).length).toBe(1);
  });
});

describe('installation.deleted disables the connection', () => {
  it('flips enabled=false', async () => {
    const res = await deliver('installation', { action: 'deleted', installation: { id: 555 } }, 'd-del');
    expect(res.statusCode).toBe(200);
    expect((await getIntegration(t.db, orgId, 'github'))!.enabled).toBe(false);
  });
});

describe('repository webhook keeps catalog fresh', () => {
  beforeAll(async () => {
    await t.store.db.collection('org_integrations').doc(`${orgId}_github`).update({ enabled: true });
  });

  it('repository:created upserts a catalog row', async () => {
    const body = { action: 'created', installation: { id: 555 }, repository: { full_name: 'acme/brand-new', default_branch: 'main', private: false }, sender: { login: 'octocat' } };
    const res = await deliver('repository', body, 'd-cat-1');
    expect(res.statusCode).toBeLessThan(300);
    const cat = (await searchCatalog(t.db, seededIntegrationId, {})).rows;
    expect(cat.map((r: { repoFullName: string }) => r.repoFullName)).toContain('acme/brand-new');
  });

  it('repository:deleted removes the catalog row', async () => {
    await deliver('repository', { action: 'created', installation: { id: 555 }, repository: { full_name: 'acme/gone', default_branch: 'main', private: false } }, 'd-cat-2a');
    await deliver('repository', { action: 'deleted', installation: { id: 555 }, repository: { full_name: 'acme/gone' } }, 'd-cat-2b');
    const cat = (await searchCatalog(t.db, seededIntegrationId, {})).rows;
    expect(cat.map((r: { repoFullName: string }) => r.repoFullName)).not.toContain('acme/gone');
  });
});
