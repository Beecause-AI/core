import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import { stripeFromConfig, priceIdForBand, verifyStripeSignature } from '../src/billing/stripe.js';

describe('stripe client (offline)', () => {
  it('is inert without a secret key', () => {
    expect(stripeFromConfig({ STRIPE_SECRET_KEY: undefined })).toBeNull();
    expect(stripeFromConfig({ STRIPE_SECRET_KEY: 'sk_test_x' })).not.toBeNull();
  });
  it('maps only self-serve bands to a configured price id', () => {
    const cfg = { STRIPE_PRICE_STARTUP: 'price_startup', STRIPE_PRICE_SCALEUP: 'price_scaleup' };
    expect(priceIdForBand(cfg, 'startup')).toBe('price_startup');
    expect(priceIdForBand(cfg, 'scaleup')).toBe('price_scaleup');
    expect(priceIdForBand(cfg, 'indie')).toBeNull();
    expect(priceIdForBand(cfg, 'enterprise')).toBeNull();
    expect(priceIdForBand({}, 'startup')).toBeNull();
  });
  it('rejects a bad webhook signature and accepts a valid generated one', () => {
    const stripe = new Stripe('sk_test_dummy');
    const secret = 'whsec_testsecret';
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: {} } });
    expect(verifyStripeSignature(stripe, payload, undefined, secret)).toBeNull();
    expect(verifyStripeSignature(stripe, payload, 't=1,v1=bad', secret)).toBeNull();
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const ev = verifyStripeSignature(stripe, payload, header, secret);
    expect(ev?.type).toBe('customer.subscription.deleted');
  });
});
