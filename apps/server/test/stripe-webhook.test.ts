import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createOrgWithOwner, setOrgBillingState, getOrgById } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const STRIPE_SECRET = 'sk_test_dummy';
const WEBHOOK_SECRET = 'whsec_testsecret';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let appInert: Awaited<ReturnType<typeof buildApp>>;
const stripe = new Stripe(STRIPE_SECRET);

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config: { ...testConfig, STRIPE_SECRET_KEY: STRIPE_SECRET, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }, email: fakeEmail().api });
  appInert = await buildApp({ db: t.db, store: t.store, config: testConfig, email: fakeEmail().api });
});
afterAll(async () => { await t.stop?.(); });

function signed(payload: string) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

describe('POST /api/stripe', () => {
  it('rejects a bad signature with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, payload: '{"id":"evt_x"}' });
    expect(res.statusCode).toBe(400);
  });
  it('applies a valid customer.subscription.deleted event', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'Hook Org', slug: `hook-${randomUUID().slice(0, 8)}`, userId: randomUUID() });
    await setOrgBillingState(t.db, org.id, { stripeCustomerId: 'cus_hook', subscriptionStatus: 'active' });
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_hook' } } });
    const res = await app.inject({ method: 'POST', url: '/api/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': signed(payload) }, payload });
    expect(res.statusCode).toBe(200);
    expect((await getOrgById(t.db, org.id))?.subscriptionStatus).toBe('canceled');
  });
  it('is inert (200 ignored) when Stripe is not configured', async () => {
    const res = await appInert.inject({ method: 'POST', url: '/api/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': 'whatever' }, payload: '{"id":"evt_y"}' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: true });
  });
});
