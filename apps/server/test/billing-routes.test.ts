import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;
let userCookie: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, email: fakeEmail().api });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  // Add a plain user member
  const mid = `${org.id}_u-user`;
  await t.store.db.collection('org_members').doc(mid).set({
    id: mid, orgId: org.id, userId: 'u-user', role: 'user', createdAt: new Date(),
  });
  ownerCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@acme.dev' }, testConfig.SESSION_SECRET) };
  userCookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-user', email: 'user@acme.dev' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('GET /api/org/billing', () => {
  it('returns billing state for an org member (owner)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/billing', cookies: ownerCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stripeReady).toBe(false);
    expect(body.band).toBe('indie');
    expect(body.usage.billableCostUsd).toBe(0);
    expect(body.spendCapUsd).toBeNull();
    expect(body.billingEnabled).toBeDefined();
  });

  it('is readable by a plain user member (member-level guard)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/billing', cookies: userCookie, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/billing', headers: ACM_HOST });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/org/billing/checkout', () => {
  it('returns 400 when Stripe is not configured', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/billing/checkout',
      cookies: ownerCookie, headers: ACM_HOST,
      payload: { band: 'startup' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/billing not configured/i);
  });

  it('rejects a plain user member with 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/billing/checkout',
      cookies: userCookie, headers: ACM_HOST,
      payload: { band: 'startup' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/org/billing/band', () => {
  it('allows an admin to set aiSpendCapUsd', async () => {
    const patch = await app.inject({
      method: 'PATCH', url: '/api/org/billing/band',
      cookies: ownerCookie, headers: ACM_HOST,
      payload: { aiSpendCapUsd: 25 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().ok).toBe(true);

    // Verify the cap is reflected in GET /api/org/billing
    const get = await app.inject({ method: 'GET', url: '/api/org/billing', cookies: ownerCookie, headers: ACM_HOST });
    expect(get.statusCode).toBe(200);
    expect(get.json().spendCapUsd).toBe(25);
  });

  it('rejects a plain user member with 404', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/billing/band',
      cookies: userCookie, headers: ACM_HOST,
      payload: { aiSpendCapUsd: 10 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/org/billing/portal', () => {
  it('returns 400 when no Stripe customer exists', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/billing/portal',
      cookies: ownerCookie, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no billing customer/i);
  });

  it('rejects a plain user member with 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/billing/portal',
      cookies: userCookie, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});
