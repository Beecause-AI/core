/**
 * Regression: legacy org docs (created before the billing fields were added) have no
 * billingBand / billingEnabled stored in Firestore. GET /api/org/billing must not 500.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let ownerCookie: Record<string, string>;
let legacyHost: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, email: fakeEmail().api });

  // Write a raw org document WITHOUT billing fields — mimics a prod org created before
  // the billing branch was deployed.
  const orgId = 'legacy-org-id';
  const slug = 'legacy-org';
  await t.db.collection('organizations').doc(orgId).set({
    id: orgId,
    name: 'Legacy Org',
    slug,
    plan: 'free',
    status: 'active',
    createdAt: new Date(),
    // intentionally omitting: billingBand, billingEnabled, stripeCustomerId, etc.
  });

  // Add an owner membership for this org.
  const memberId = `${orgId}_u-legacy-owner`;
  await t.db.collection('org_members').doc(memberId).set({
    id: memberId,
    orgId,
    userId: 'u-legacy-owner',
    role: 'owner',
    createdAt: new Date(),
  });

  ownerCookie = {
    [SESSION_COOKIE]: await createSessionToken(
      { sub: 'u-legacy-owner', email: 'owner@legacy.dev' },
      testConfig.SESSION_SECRET,
    ),
  };
  legacyHost = { 'x-forwarded-host': `${slug}.beecause.ai` };
});

afterAll(async () => {
  await app.close();
  await t.stop();
});

describe('GET /api/org/billing — legacy org without billing fields', () => {
  it('returns 200 (not 500) with defaults for an org that has no billing fields stored', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/org/billing',
      cookies: ownerCookie,
      headers: legacyHost,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.band).toBe('indie');
    expect(body.billingEnabled).toBe(false);
    expect(body.spendCapUsd).toBeNull();
    expect(body.subscriptionStatus).toBeNull();
  });
});
