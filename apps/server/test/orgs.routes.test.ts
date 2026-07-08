import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let cookieU1: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });
  cookieU1 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u1', email: 'a@b.c' }, testConfig.SESSION_SECRET) };
  await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('org routes', () => {
  it('GET /api/me returns the session user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', cookies: cookieU1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().sub).toBe('u1');
  });

  it('GET /api/orgs lists my orgs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orgs', cookies: cookieU1 });
    expect(res.json().map((o: { slug: string }) => o.slug)).toEqual(['acme']);
  });

  it('POST /api/orgs is gone — orgs are founded via signup only (each org = a realm)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/orgs', cookies: cookieU1,
      payload: { name: 'Acme 2', slug: 'acme-2' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orgs' });
    expect(res.statusCode).toBe(401);
  });
});
