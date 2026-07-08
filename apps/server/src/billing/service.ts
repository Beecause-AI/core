import type Stripe from 'stripe';
import type { Db, Organization, BillingBandId } from '@intellilabs/core';
import { setOrgBillingState, getOrgByStripeCustomerId, getOrgById } from '@intellilabs/core';
import { BANDS, addCredits } from '@intellilabs/billing';
import type { AppConfig } from '../config.js';
import { ensureCustomer, createBandSubscription, priceIdForBand } from './stripe.js';

export interface BillingCtx {
  stripe: Stripe;
  db: Db;
  cfg: Pick<AppConfig, 'STRIPE_PRICE_STARTUP' | 'STRIPE_PRICE_SCALEUP'>;
}

/** Start a paid subscription for a self-serve band: ensure customer → create subscription →
 *  persist billing state and flip billingEnabled. Throws for non-self-serve or unpriced bands. */
export async function startSubscriptionForBand(
  ctx: BillingCtx, args: { org: Organization; band: BillingBandId },
): Promise<{ subscriptionId: string; status: string }> {
  const band = BANDS[args.band];
  if (!band.selfServe) throw new Error(`band ${args.band} is not self-serve`);
  const priceId = priceIdForBand(ctx.cfg, args.band);
  if (!priceId) throw new Error(`no Stripe price configured for band ${args.band}`);
  if (args.org.stripeSubscriptionId) throw new Error('subscription already active');
  const customerId = await ensureCustomer(ctx.stripe, { orgId: args.org.id, name: args.org.name, existingId: args.org.stripeCustomerId });
  const { subscriptionId, status } = await createBandSubscription(ctx.stripe, { customerId, priceId, idempotencyKey: `sub_${args.org.id}_${args.band}` });
  await setOrgBillingState(ctx.db, args.org.id, {
    billingEnabled: true, billingBand: args.band,
    stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, subscriptionStatus: status,
  });
  return { subscriptionId, status };
}

/** Reconcile a verified Stripe event into org billing state. Unknown/irrelevant events are ignored. */
export async function applyStripeEvent(db: Db, event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as {
      mode?: string; payment_status?: string; payment_intent?: string | null;
      metadata?: { orgId?: string; kind?: string; creditCents?: string } | null;
    };
    if (s.mode !== 'payment' || s.payment_status !== 'paid') return;
    if (s.metadata?.kind !== 'credit_topup') return;
    const orgId = s.metadata.orgId;
    const creditCents = Number(s.metadata.creditCents);
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : null;
    if (!orgId || !(creditCents > 0) || !pi) return;
    if (!(await getOrgById(db, orgId))) return;
    await addCredits(db, { orgId, amountCents: creditCents, kind: 'purchase', stripePaymentIntentId: pi, ledgerId: `topup_${pi}` });
    return;
  }
  const obj = event.data.object as { customer?: string | null; status?: string | null };
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  if (!customerId) return;
  const org = await getOrgByStripeCustomerId(db, customerId);
  if (!org) return;
  if (event.type === 'customer.subscription.deleted') {
    await setOrgBillingState(db, org.id, { subscriptionStatus: 'canceled' });
  } else if (event.type === 'customer.subscription.updated') {
    await setOrgBillingState(db, org.id, { subscriptionStatus: obj.status ?? org.subscriptionStatus });
  } else if (event.type === 'invoice.payment_failed') {
    await setOrgBillingState(db, org.id, { subscriptionStatus: 'past_due' });
  }
}
