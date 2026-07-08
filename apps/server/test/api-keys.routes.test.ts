import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createOrgWithOwner } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let cookie: Record<string, string>;
let otherCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, email: fakeEmail().api });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  for (const userId of ['u-member', 'u-other']) {
    const mid = `${org.id}_${userId}`;
    await t.store.db.collection('org_members').doc(mid).set({ id: mid, orgId: org.id, userId, role: 'user', createdAt: new Date() });
  }
  cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-member', email: 'm@x.dev' }, testConfig.SESSION_SECRET) };
  otherCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-other', email: 'o@x.dev' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

const create = (payload: Record<string, string>, cookies = cookie) =>
  app.inject({ method: 'POST', url: '/api/keys', cookies, headers: ACM_HOST, payload });
const list = (cookies = cookie) =>
  app.inject({ method: 'GET', url: '/api/keys', cookies, headers: ACM_HOST });

describe('POST /api/keys', () => {
  it('creates a key, returns the plaintext once, and never returns the hash', async () => {
    const res = await create({ name: 'CI' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^bee_/);
    expect(body.row).toMatchObject({ name: 'CI', keyPrefix: body.key.slice(0, 12) });
    expect(body.row.keyHash).toBeUndefined();
  });

  it('rejects a blank name with 400', async () => {
    const res = await create({ name: '' });
    expect(res.statusCode).toBe(400);
  });

  it('401s without a session', async () => {
    const res = await create({ name: 'x' }, {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects a past expiry with 400', async () => {
    const res = await create({ name: 'old', expiresAt: '2000-01-01T00:00:00.000Z' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a future expiry and echoes it on the row', async () => {
    const future = '2999-01-01T00:00:00.000Z';
    const res = await create({ name: 'future', expiresAt: future });
    expect(res.statusCode).toBe(201);
    expect(new Date(res.json().row.expiresAt).toISOString()).toBe(future);
  });
});

describe('GET /api/keys', () => {
  it('lists the caller keys without plaintext or hash', async () => {
    await create({ name: 'listed' });
    const res = await list();
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r: { name: string }) => r.name === 'listed')).toBe(true);
    for (const r of rows) { expect(r.key).toBeUndefined(); expect(r.keyHash).toBeUndefined(); }
  });
});

describe('DELETE /api/keys/:id', () => {
  it('revokes an owned key (204), then 404s, and removes it from the list', async () => {
    const created = (await create({ name: 'revoke-me' })).json();
    const id = created.row.id;
    const del = await app.inject({ method: 'DELETE', url: `/api/keys/${id}`, cookies: cookie, headers: ACM_HOST });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({ method: 'DELETE', url: `/api/keys/${id}`, cookies: cookie, headers: ACM_HOST });
    expect(again.statusCode).toBe(404);
    const rows = (await list()).json();
    expect(rows.some((r: { id: string }) => r.id === id)).toBe(false);
  });

  it('404s (not 500) for a non-uuid id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/keys/not-a-uuid', cookies: cookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});

describe('cross-user isolation', () => {
  it('a member cannot see or revoke another member\'s key', async () => {
    const mine = (await create({ name: 'mine-only' })).json().row; // owned by u-member
    const otherList = (await app.inject({ method: 'GET', url: '/api/keys', cookies: otherCookie, headers: ACM_HOST })).json();
    expect(otherList.some((r: { id: string }) => r.id === mine.id)).toBe(false);
    const del = await app.inject({ method: 'DELETE', url: `/api/keys/${mine.id}`, cookies: otherCookie, headers: ACM_HOST });
    expect(del.statusCode).toBe(404);
  });
});

describe('API key authentication', () => {
  it('authenticates an org-scoped request via Authorization: Bearer bee_…', async () => {
    const key = (await create({ name: 'auth' })).json().key as string;
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects',
      headers: { ...ACM_HOST, authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(200); // member can list projects (empty array ok)
  });

  it('still authenticates a legacy ilk_-prefixed key (prefix is cosmetic; lookup is by hash)', async () => {
    const { hashApiKey, getOrgBySlug } = await import('@intellilabs/core');
    const org = await getOrgBySlug(t.db, 'acme');
    const legacy = 'ilk_legacy-compat-test-key-0001';
    const legacyId = randomUUID();
    await t.store.db.collection('api_keys').doc(legacyId).set({
      id: legacyId, userId: 'u-member', orgId: org!.id, name: 'legacy',
      keyHash: hashApiKey(legacy), keyPrefix: legacy.slice(0, 12),
      expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: new Date(),
    });
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects',
      headers: { ...ACM_HOST, authorization: `Bearer ${legacy}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a revoked key with 401', async () => {
    const created = (await create({ name: 'to-revoke' })).json();
    await app.inject({ method: 'DELETE', url: `/api/keys/${created.row.id}`, cookies: cookie, headers: ACM_HOST });
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects',
      headers: { ...ACM_HOST, authorization: `Bearer ${created.key}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired key with 401', async () => {
    // create a key via the core repo with an expiry in the past
    const { createApiKey, getOrgBySlug } = await import('@intellilabs/core');
    const org = await getOrgBySlug(t.db, 'acme');
    const { plaintext } = await createApiKey(t.db, { userId: 'u-member', orgId: org!.id, name: 'expired', expiresAt: new Date(Date.now() - 1000) });
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects',
      headers: { ...ACM_HOST, authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a key whose org does not match the host', async () => {
    const key = (await create({ name: 'wrong-org' })).json().key as string;
    await createOrgWithOwner(t.db, { name: 'Other', slug: 'other', userId: 'u-other-owner' });
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects',
      headers: { 'x-forwarded-host': 'other.beecause.ai', authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('ignores a non-key bearer token (falls through to 401)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects',
      headers: { ...ACM_HOST, authorization: 'Bearer not-an-ilk-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
