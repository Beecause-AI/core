import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner, getOrgById, setOrgBillingState } from '../src/repos/orgs.js';

const t = testStore('org-billing-fields');
afterAll(() => t.close());

describe('org billing fields', () => {
  it('defaults billing state on creation', async () => {
    const userId = randomUUID();
    const org = await createOrgWithOwner(t.db, { name: 'Bill Org', slug: `bill-${userId.slice(0, 8)}`, userId });
    expect(org.billingEnabled).toBe(false);
    expect(org.billingBand).toBe('indie');
    expect(org.stripeCustomerId).toBeNull();
    expect(org.stripeSubscriptionId).toBeNull();
    expect(org.subscriptionStatus).toBeNull();
    expect(org.aiSpendCapUsd).toBeNull();
  });
  it('setOrgBillingState updates and persists', async () => {
    const userId = randomUUID();
    const org = await createOrgWithOwner(t.db, { name: 'Bill Org 2', slug: `bill2-${userId.slice(0, 8)}`, userId });
    await setOrgBillingState(t.db, org.id, { billingEnabled: true, billingBand: 'startup', stripeCustomerId: 'cus_1', subscriptionStatus: 'active', aiSpendCapUsd: 50 });
    const reread = await getOrgById(t.db, org.id);
    expect(reread?.billingEnabled).toBe(true);
    expect(reread?.billingBand).toBe('startup');
    expect(reread?.stripeCustomerId).toBe('cus_1');
    expect(reread?.subscriptionStatus).toBe('active');
    expect(reread?.aiSpendCapUsd).toBe(50);
  });
});
