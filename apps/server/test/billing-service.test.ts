import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOrgWithOwner, getOrgById, setOrgBillingState } from '@intellilabs/core';
import { startTestDb } from './helpers.js';
import { startSubscriptionForBand, applyStripeEvent } from '../src/billing/service.js';

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

const fakeStripe = {
  customers: { create: async () => ({ id: 'cus_test' }) },
  subscriptions: { create: async () => ({ id: 'sub_test', status: 'active' }) },
} as unknown as import('stripe').default;
const cfg = { STRIPE_PRICE_STARTUP: 'price_startup', STRIPE_PRICE_SCALEUP: 'price_scaleup' };

describe('billing service', () => {
  it('startSubscriptionForBand persists state and enables billing', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'Sub Org', slug: `sub-${randomUUID().slice(0, 8)}`, userId: randomUUID() });
    const res = await startSubscriptionForBand({ stripe: fakeStripe, db: t.db, cfg }, { org, band: 'startup' });
    expect(res).toEqual({ subscriptionId: 'sub_test', status: 'active' });
    const reread = await getOrgById(t.db, org.id);
    expect(reread?.billingEnabled).toBe(true);
    expect(reread?.billingBand).toBe('startup');
    expect(reread?.stripeCustomerId).toBe('cus_test');
    expect(reread?.stripeSubscriptionId).toBe('sub_test');
    expect(reread?.subscriptionStatus).toBe('active');
  });
  it('rejects non-self-serve / unpriced bands', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'Ent Org', slug: `ent-${randomUUID().slice(0, 8)}`, userId: randomUUID() });
    await expect(startSubscriptionForBand({ stripe: fakeStripe, db: t.db, cfg }, { org, band: 'enterprise' })).rejects.toThrow();
    await expect(startSubscriptionForBand({ stripe: fakeStripe, db: t.db, cfg }, { org, band: 'indie' })).rejects.toThrow();
  });
  it('applyStripeEvent syncs status by stripe customer id', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'Evt Org', slug: `evt-${randomUUID().slice(0, 8)}`, userId: randomUUID() });
    await setOrgBillingState(t.db, org.id, { stripeCustomerId: 'cus_evt', subscriptionStatus: 'active' });
    await applyStripeEvent(t.db, { type: 'customer.subscription.deleted', data: { object: { customer: 'cus_evt' } } } as unknown as import('stripe').default.Event);
    expect((await getOrgById(t.db, org.id))?.subscriptionStatus).toBe('canceled');
    await applyStripeEvent(t.db, { type: 'invoice.payment_failed', data: { object: { customer: 'cus_evt' } } } as unknown as import('stripe').default.Event);
    expect((await getOrgById(t.db, org.id))?.subscriptionStatus).toBe('past_due');
  });
  it('applyStripeEvent customer.subscription.updated sets subscriptionStatus', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'Upd Org', slug: `upd-${randomUUID().slice(0, 8)}`, userId: randomUUID() });
    await setOrgBillingState(t.db, org.id, { stripeCustomerId: 'cus_upd', subscriptionStatus: 'active' });
    await applyStripeEvent(t.db, { type: 'customer.subscription.updated', data: { object: { customer: 'cus_upd', status: 'past_due' } } } as unknown as import('stripe').default.Event);
    expect((await getOrgById(t.db, org.id))?.subscriptionStatus).toBe('past_due');
  });
  it('startSubscriptionForBand throws when subscription already active', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'Dup Org', slug: `dup-${randomUUID().slice(0, 8)}`, userId: randomUUID() });
    await setOrgBillingState(t.db, org.id, { stripeSubscriptionId: 'sub_existing' });
    const orgWithSub = (await getOrgById(t.db, org.id))!;
    await expect(startSubscriptionForBand({ stripe: fakeStripe, db: t.db, cfg }, { org: orgWithSub, band: 'startup' })).rejects.toThrow('subscription already active');
  });
});
