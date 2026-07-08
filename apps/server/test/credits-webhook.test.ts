import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from '../../../packages/core/test/store/emulator.js';
import { createOrgWithOwner, setOrgBillingState } from '@intellilabs/core';
import { getCreditBalanceCents } from '@intellilabs/billing';
import { applyStripeEvent } from '../src/billing/service.js';
import type Stripe from 'stripe';

const t = testStore('credits-webhook');
afterAll(() => t.close());

function sessionEvent(orgId: string, creditCents: number, pi: string): Stripe.Event {
  return {
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout_session', mode: 'payment', payment_status: 'paid',
      payment_intent: pi, metadata: { orgId, kind: 'credit_topup', creditCents: String(creditCents) } } },
  } as unknown as Stripe.Event;
}

describe('credit top-up webhook', () => {
  it('credits net amount once and is idempotent on the PaymentIntent', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'O', slug: `wh-${randomUUID().slice(0,8)}`, userId: randomUUID() });
    await setOrgBillingState(t.db, org.id, { stripeCustomerId: `cus_${org.id}` });
    const ev = sessionEvent(org.id, 10000, 'pi_abc');
    await applyStripeEvent(t.db, ev);
    await applyStripeEvent(t.db, ev); // duplicate delivery
    expect(await getCreditBalanceCents(t.db, org.id)).toBe(10000);
  });
  it('ignores non-credit sessions', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'O', slug: `wh2-${randomUUID().slice(0,8)}`, userId: randomUUID() });
    const ev = { type: 'checkout.session.completed', data: { object: { object: 'checkout_session', mode: 'subscription', payment_status: 'paid', metadata: {} } } } as unknown as Stripe.Event;
    await applyStripeEvent(t.db, ev);
    expect(await getCreditBalanceCents(t.db, org.id)).toBe(0);
  });
});
