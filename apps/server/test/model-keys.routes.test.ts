import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
// A valid base64 32-byte AES key so encryptSecret works in-route.
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

// A fake probe: any key containing 'bad' is rejected; everything else is accepted.
const fakeProbe = async (_provider: string, key: string) =>
  key.includes('bad') ? { ok: false, status: 401, detail: 'bad' } : { ok: true, status: 200 };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;
let userCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api, probe: fakeProbe });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  await activateOrg(t.db, org.id);
  // A plain 'user'-role member to prove requireOrgAdmin hides the route (404).
  const memberId = `${org.id}_u-user`;
  await t.store.db.collection('org_members').doc(memberId).set({ id: memberId, orgId: org.id, userId: 'u-user', role: 'user', createdAt: new Date() });
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, config.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-user', email: 'user@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const list = (cookies = ownerCookie) =>
  app.inject({ method: 'GET', url: '/api/model-keys', cookies, headers: ACM_HOST });
const put = (provider: string, payload: Record<string, unknown>, cookies = ownerCookie) =>
  app.inject({ method: 'PUT', url: `/api/model-keys/${provider}`, cookies, headers: ACM_HOST, payload });
const patch = (provider: string, payload: Record<string, unknown>, cookies = ownerCookie) =>
  app.inject({ method: 'PATCH', url: `/api/model-keys/${provider}`, cookies, headers: ACM_HOST, payload });
const del = (provider: string, cookies = ownerCookie) =>
  app.inject({ method: 'DELETE', url: `/api/model-keys/${provider}`, cookies, headers: ACM_HOST });
const test = (provider: string, cookies = ownerCookie) =>
  app.inject({ method: 'POST', url: `/api/model-keys/${provider}/test`, cookies, headers: ACM_HOST });

describe('GET /api/model-keys', () => {
  it('returns an empty list initially (owner cookie)', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('PUT /api/model-keys/:provider — probe-on-save', () => {
  it('stores a valid anthropic key (201), returns metadata only, never the plaintext', async () => {
    const key = 'goodkey12';
    const res = await put('anthropic', { key });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ provider: 'anthropic', keyHint: '…ey12', enabled: false, lastTestOk: true });
    // The plaintext must never leak — neither as a value nor a ciphertext field.
    expect(body.keyCiphertext).toBeUndefined();
    for (const v of Object.values(body)) expect(v).not.toBe(key);
    expect(JSON.stringify(body)).not.toContain(key);
    await del('anthropic');
  });

  it('rejects an invalid key (400) and stores NOTHING', async () => {
    const res = await put('anthropic', { key: 'badkey99' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'key rejected', detail: 'bad' });
    // Follow-up GET must not include anthropic — nothing was stored.
    const rows = (await list()).json();
    expect(rows.find((r: { provider: string }) => r.provider === 'anthropic')).toBeUndefined();
  });

  it('stores an openai-compatible key with a baseUrl (201) and GET reflects baseUrl', async () => {
    const res = await put('openai-compatible', { key: 'goodkey12', baseUrl: 'https://api.groq.com/openai/v1' });
    expect(res.statusCode).toBe(201);
    const row = (await list()).json().find((r: { provider: string }) => r.provider === 'openai-compatible');
    expect(row).toMatchObject({ provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' });
    await del('openai-compatible');
  });

  it('rejects openai-compatible with no baseUrl (400)', async () => {
    const res = await put('openai-compatible', { key: 'goodkey12' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/baseUrl required/);
  });

  it('rejects openai-compatible with an unsafe baseUrl (400, SSRF guard)', async () => {
    const res = await put('openai-compatible', { key: 'goodkey12', baseUrl: 'https://localhost/v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not allowed/);
  });

  it('rejects an unsupported provider (400)', async () => {
    const res = await put('bogusprov', { key: 'goodkey12' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unsupported provider/);
  });

  it('rejects a too-short key with 400', async () => {
    const res = await put('anthropic', { key: 'short' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/model-keys/:provider/test', () => {
  it('returns {ok:true} for a stored valid anthropic key (200)', async () => {
    await put('anthropic', { key: 'goodkey12' });
    const res = await test('anthropic');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await del('anthropic');
  });

  it('404s when testing a provider with no stored key', async () => {
    const res = await test('openai');
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/model-keys/:provider', () => {
  it('toggles enabled (200) and the change is reflected in the list', async () => {
    await put('anthropic', { key: 'goodkey12' });
    const res = await patch('anthropic', { enabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: 'anthropic', enabled: true });
    const row = (await list()).json().find((r: { provider: string }) => r.provider === 'anthropic');
    expect(row.enabled).toBe(true);
    await del('anthropic');
  });

  it('404s when toggling a provider with no stored key', async () => {
    const missing = await patch('nope', { enabled: true });
    expect(missing.statusCode).toBe(404);
  });
});

describe('DELETE /api/model-keys/:provider', () => {
  it('deletes a stored key (204), leaving an empty list', async () => {
    await put('anthropic', { key: 'goodkey12' });
    const res = await del('anthropic');
    expect(res.statusCode).toBe(204);
    expect((await list()).json()).toEqual([]);
    // deleting again → 404
    expect((await del('anthropic')).statusCode).toBe(404);
  });
});

// Regression: the web api() helper used to set `content-type: application/json` on every
// request, including no-body DELETE / POST /test. Fastify then tried to parse an empty JSON
// body and threw FST_ERR_CTP_EMPTY_JSON_BODY, which the error handler mapped to 500. The
// content-type parser added in buildApp must treat an empty body as undefined, not 500.
describe('empty JSON body (content-type set, no payload) must not 500', () => {
  const JSON_CT = { ...ACM_HOST, 'content-type': 'application/json' } as Record<string, string>;

  it('DELETE with json content-type + no body → 204 for an existing key', async () => {
    await put('anthropic', { key: 'goodkey12' });
    const res = await app.inject({
      method: 'DELETE', url: '/api/model-keys/anthropic', cookies: ownerCookie, headers: JSON_CT,
    });
    expect(res.statusCode).toBe(204);
  });

  it('DELETE with json content-type + no body → 404 for a missing key (not 500)', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/model-keys/anthropic', cookies: ownerCookie, headers: JSON_CT,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /test with json content-type + no body → 200 for a stored key (not 500)', async () => {
    await put('anthropic', { key: 'goodkey12' });
    const res = await app.inject({
      method: 'POST', url: '/api/model-keys/anthropic/test', cookies: ownerCookie, headers: JSON_CT,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await del('anthropic');
  });
});

describe('UI-only: session-gated, no API keys', () => {
  it('rejects an API-key bearer token with no session cookie (401)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/model-keys',
      headers: { ...ACM_HOST, authorization: 'Bearer ilk_whatever' },
    });
    // requireSessionUser rejects before any key lookup.
    expect(res.statusCode).toBe(401);
  });
});

describe('owner/manager only', () => {
  it('hides the route from a plain user-role member (404)', async () => {
    const res = await list(userCookie);
    expect(res.statusCode).toBe(404);
  });
});
