import Stripe from 'stripe';
import type { AppConfig } from '../config.js';
import type { BillingBandId } from '@intellilabs/core';

/** Construct a Stripe client from config, or null when no secret key is set (inert). */
export function stripeFromConfig(cfg: Pick<AppConfig, 'STRIPE_SECRET_KEY'>): Stripe | null {
  if (!cfg.STRIPE_SECRET_KEY) return null;
  return new Stripe(cfg.STRIPE_SECRET_KEY);
}

/** The configured Stripe recurring Price id for a band, or null (free/custom/unset). */
export function priceIdForBand(cfg: Pick<AppConfig, 'STRIPE_PRICE_STARTUP' | 'STRIPE_PRICE_SCALEUP'>, band: BillingBandId): string | null {
  if (band === 'startup') return cfg.STRIPE_PRICE_STARTUP ?? null;
  if (band === 'scaleup') return cfg.STRIPE_PRICE_SCALEUP ?? null;
  return null; // indie (free) and enterprise (custom) have no self-serve price
}

/** Ensure a Stripe Customer exists for the org; returns the customer id. */
export async function ensureCustomer(
  stripe: Stripe,
  args: { orgId: string; name: string; email?: string | null; existingId?: string | null },
): Promise<string> {
  if (args.existingId) return args.existingId;
  const customer = await stripe.customers.create({
    name: args.name,
    email: args.email ?? undefined,
    metadata: { orgId: args.orgId },
  });
  return customer.id;
}

/** Create a subscription for the customer on the given recurring price. */
export async function createBandSubscription(
  stripe: Stripe,
  args: { customerId: string; priceId: string; idempotencyKey?: string },
): Promise<{ subscriptionId: string; status: string }> {
  const sub = await stripe.subscriptions.create(
    { customer: args.customerId, items: [{ price: args.priceId }] },
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
  );
  return { subscriptionId: sub.id, status: sub.status };
}

/** Create a Billing Customer-Portal session; returns the URL to redirect to. */
export async function createPortalSession(
  stripe: Stripe,
  args: { customerId: string; returnUrl: string },
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({ customer: args.customerId, return_url: args.returnUrl });
  return session.url;
}

/** One-time Checkout Session that sells `creditCents` of AI credit (net); Stripe Tax adds VAT. */
export async function createCreditCheckoutSession(
  stripe: Stripe,
  args: { customerId: string; creditCents: number; orgId: string; successUrl: string; cancelUrl: string },
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: args.customerId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: args.creditCents,
        tax_behavior: 'exclusive',
        product_data: { name: 'Beecause AI credits' },
      },
    }],
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    metadata: { orgId: args.orgId, kind: 'credit_topup', creditCents: String(args.creditCents) },
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  });
  if (!session.url) throw new Error('checkout session has no url');
  return session.url;
}

/** Verify a Stripe webhook signature and return the parsed event, or null on failure. */
export function verifyStripeSignature(stripe: Stripe, rawBody: string, sigHeader: string | undefined, secret: string): Stripe.Event | null {
  if (!sigHeader || !secret) return null;
  try { return stripe.webhooks.constructEvent(rawBody, sigHeader, secret); }
  catch { return null; }
}
