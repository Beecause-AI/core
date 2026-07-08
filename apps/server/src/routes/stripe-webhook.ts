import type { FastifyInstance } from 'fastify';
import { stripeFromConfig, verifyStripeSignature } from '../billing/stripe.js';
import { applyStripeEvent } from '../billing/service.js';

export async function stripeWebhookRoutes(app: FastifyInstance) {
  app.post('/stripe', async (req, reply) => {
    const stripe = stripeFromConfig(app.config);
    const secret = app.config.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return reply.code(200).send({ ignored: true }); // inert until configured
    const sig = req.headers['stripe-signature'] as string | undefined;
    const event = verifyStripeSignature(stripe, req.rawBody ?? '', sig, secret);
    if (!event) return reply.code(400).send({ error: 'bad signature' });
    await applyStripeEvent(app.db, event).catch(() => { /* best-effort; ack so Stripe doesn't hammer-retry */ });
    return reply.code(200).send({ received: true });
  });
}
