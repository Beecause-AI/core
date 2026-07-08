import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { startTestDb, testConfig } from './helpers.js';
import { createOrgWithOwner, upsertUser } from '@intellilabs/core';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig });

  // Seed: user jo@acme.com belongs to two active orgs (owner membership auto-created).
  await upsertUser(t.db, { userId: 'u-jo', email: 'jo@acme.com' });
  await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-jo' });
  await createOrgWithOwner(t.db, { name: 'Acme Labs', slug: 'acme-labs', userId: 'u-jo' });
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('POST /api/auth/workspaces', () => {
  it('returns orgs for a known email regardless of case', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/workspaces',
      payload: { email: 'Jo@ACME.com ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgs: [{ slug: 'acme', name: 'Acme' }, { slug: 'acme-labs', name: 'Acme Labs' }] });
  });

  it('returns an empty list (same shape, 200) for unknown emails', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/workspaces',
      payload: { email: 'nobody@x.dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgs: [] });
  });

  it('400s on malformed email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/workspaces',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('429s past the rate limit from one IP (keyed on socket/req.ip)', async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/workspaces',
        payload: { email: 'a@b.co' },
        remoteAddress: '9.9.9.9',
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/workspaces',
      payload: { email: 'a@b.co' },
      remoteAddress: '9.9.9.9',
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('forged cf-connecting-ip header does not bypass the rate limiter', async () => {
    // Security: an attacker who sends each request with a different cf-connecting-ip value
    // must NOT get a fresh bucket each time. The key must be req.ip (socket address),
    // not the forgeable CF header. After 5 requests from 8.8.8.8 the 6th must 429
    // regardless of what cf-connecting-ip the attacker supplies.
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/workspaces',
        payload: { email: 'a@b.co' },
        remoteAddress: '8.8.8.8',
        headers: { 'cf-connecting-ip': `10.0.0.${i}` },  // attacker varies this
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/workspaces',
      payload: { email: 'a@b.co' },
      remoteAddress: '8.8.8.8',
      headers: { 'cf-connecting-ip': '10.0.0.99' },  // yet another forged value
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
