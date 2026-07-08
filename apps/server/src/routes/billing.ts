import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { setOrgBillingState, type BillingBandId } from '@intellilabs/core';
import { getBillableUsage, BANDS, listCreditLedger } from '@intellilabs/billing';
import { resolveOrg } from '../auth/org-context.js';
import { requireUser, requireOrgMember, requireOrgAdmin } from '../auth/guard.js';
import { stripeFromConfig, createPortalSession, createCreditCheckoutSession, ensureCustomer } from '../billing/stripe.js';
import { startSubscriptionForBand } from '../billing/service.js';

export const creditTopupBody = z.object({ amountCents: z.number().int().min(1000).max(200000) });

export async function billingRoutes(app: FastifyInstance) {
  const org = { preHandler: [resolveOrg, requireUser, requireOrgMember] };
  const orgAdmin = { preHandler: [resolveOrg, requireUser, requireOrgAdmin] };

  /** GET /api/org/billing — member-level billing state read */
  app.get('/api/org/billing', org, async (req) => {
    const o = req.org!;
    const band = BANDS[(o.billingBand ?? 'indie') as BillingBandId];
    const usage = await getBillableUsage(app.db, o.id);
    const stripeReady = stripeFromConfig(app.config) !== null;
    return {
      billingEnabled: o.billingEnabled ?? false,
      band: o.billingBand ?? 'indie',
      bandLabel: band.label,
      priceUsd: band.priceCents === null ? null : band.priceCents / 100,
      custom: band.priceCents === null,
      usage,
      spendCapUsd: o.aiSpendCapUsd ?? null,
      subscriptionStatus: o.subscriptionStatus ?? null,
      stripeReady,
      creditBalanceCents: o.creditBalanceCents ?? 0,
    };
  });

  /** POST /api/org/billing/checkout — start a self-serve subscription (admin only) */
  app.post('/api/org/billing/checkout', orgAdmin, async (req, reply) => {
    const body = z.object({ band: z.enum(['startup', 'scaleup']) }).parse(req.body);
    const stripe = stripeFromConfig(app.config);
    if (!stripe) return reply.code(400).send({ error: 'billing not configured' });
    try {
      const { status } = await startSubscriptionForBand(
        { stripe, db: app.db, cfg: app.config },
        { org: req.org!, band: body.band },
      );
      return { subscriptionStatus: status };
    } catch (e) {
      const msg = e instanceof Error && !('type' in e) ? e.message : 'payment error';
      return reply.code(400).send({ error: msg });
    }
  });

  /** POST /api/org/billing/portal — create a Stripe Customer Portal session (admin only) */
  app.post('/api/org/billing/portal', orgAdmin, async (req, reply) => {
    const stripe = stripeFromConfig(app.config);
    if (!stripe || !req.org!.stripeCustomerId) return reply.code(400).send({ error: 'no billing customer' });
    const url = await createPortalSession(stripe, {
      customerId: req.org!.stripeCustomerId,
      returnUrl: `${app.config.BASE_URL}/admin/billing`,
    });
    return { url };
  });

  /** PATCH /api/org/billing/band — pre-subscription band choice + spend-cap edit (admin only) */
  app.patch('/api/org/billing/band', orgAdmin, async (req) => {
    const body = z.object({
      band: z.enum(['indie', 'startup', 'scaleup', 'enterprise']).optional(),
      aiSpendCapUsd: z.number().nonnegative().nullable().optional(),
    }).parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.band !== undefined) patch.billingBand = body.band;
    if (body.aiSpendCapUsd !== undefined) patch.aiSpendCapUsd = body.aiSpendCapUsd;
    if (Object.keys(patch).length) await setOrgBillingState(app.db, req.org!.id, patch);
    return { ok: true };
  });

  /** POST /api/org/credits/checkout — buy a credit top-up (admin only). Inert without Stripe. */
  app.post('/api/org/credits/checkout', orgAdmin, async (req, reply) => {
    const { amountCents } = creditTopupBody.parse(req.body);
    const stripe = stripeFromConfig(app.config);
    if (!stripe) return reply.code(400).send({ error: 'billing not configured' });
    const customerId = await ensureCustomer(stripe, { orgId: req.org!.id, name: req.org!.name, existingId: req.org!.stripeCustomerId });
    if (customerId !== req.org!.stripeCustomerId) {
      await setOrgBillingState(app.db, req.org!.id, { stripeCustomerId: customerId });
    }
    const url = await createCreditCheckoutSession(stripe, {
      customerId, creditCents: amountCents, orgId: req.org!.id,
      successUrl: `${app.config.BASE_URL}/admin/billing?topup=success`,
      cancelUrl: `${app.config.BASE_URL}/admin/billing?topup=cancel`,
    });
    return { url };
  });

  /** GET /api/org/credits/ledger — recent credit movements (member-level read). */
  app.get('/api/org/credits/ledger', org, async (req) => {
    const entries = await listCreditLedger(app.db, req.org!.id, 20);
    return { entries };
  });
}
