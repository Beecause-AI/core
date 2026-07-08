import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSessionToken, createVerifyToken, verifyVerifyToken, SESSION_COOKIE } from '../auth/session.js';
import { verifyEmailHtml } from '../integrations/email/templates.js';
import { TokenBucketLimiter } from '../auth/rate-limit.js';
import { isReservedSlug } from './reserved-slugs.js';
import {
  getOrgBySlug, createPendingOrg, deleteOrg,
  setOrgIdpTenant, activateOrg, addOrgOwner, upsertUser,
} from '@intellilabs/core';

function isUniqueViolation(e: unknown): boolean {
  const code = (e ?? {}) as { code?: string; cause?: { code?: string } };
  return code.code === '23505' || code.cause?.code === '23505';
}

const Signup = z.object({
  orgName: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/, {
      message: 'Workspace URL must be 2–39 characters using lowercase letters, numbers, and hyphens.',
    })
    .refine((s) => !isReservedSlug(s), { message: 'That workspace URL is reserved.' }),
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(100),
});
const Complete = z.object({ token: z.string().min(1), password: z.string().min(10).max(200) });
const MARKETING = 'https://beecause.ai';
const PENDING_TTL_MS = 7 * 24 * 3600_000;

// Prod E2E identities: nobody can receive mail at this subdomain, so the verify
// email is suppressed (never sent). The flow is NOT short-circuited — the E2E
// runner mints the verify token itself with the session secret, so verification
// bypass stays restricted to secret holders.
const E2E_EMAIL_RE = /@e2e\.beecause\.ai$/i;

export async function signupRoutes(app: FastifyInstance) {
  const limiter = new TokenBucketLimiter({ capacity: 5, refillPerMs: 5 / 60_000 });

  app.post('/api/auth/signup', async (req, reply) => {
    if (!app.email && !app.config.AUTO_VERIFY_EMAIL) return reply.code(503).send({ error: 'signup unavailable' });
    // Use req.ip (trustProxy:1 → the GFE-appended XFF entry), NOT a client-settable
    // CF-Connecting-IP header — a direct run.app caller could otherwise forge the
    // header to mint a fresh bucket per request (same hardening as /api/auth/workspaces).
    if (!limiter.tryConsume(req.ip)) return reply.code(429).header('retry-after', '60').send({ error: 'too many requests' });

    const parsed = Signup.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { orgName, slug, email, name } = parsed.data;

    async function issueToken() {
      const token = await createVerifyToken({ slug, email, name }, app.config.SESSION_SECRET);
      if (app.config.AUTO_VERIFY_EMAIL) {
        // Dev shortcut: hand the token back instead of emailing it; the signup
        // page forwards straight to /verify?token=… to complete provisioning.
        return reply.code(200).send({ ok: true, token });
      }
      if (!E2E_EMAIL_RE.test(email)) {
        await app.email!.send({
          to: email, subject: 'Verify your Beecause email',
          html: verifyEmailHtml({ name, url: `${MARKETING}/verify?token=${token}` }),
        });
      }
      return reply.code(200).send({ ok: true });
    }

    // No Keycloak state is touched here: the realm + user are provisioned by
    // /api/auth/complete once the email round-trip proves ownership, so spam
    // signups cost one pending row — never a realm.
    const existing = await getOrgBySlug(app.db, slug);
    if (existing) {
      const sameSigner = existing.status === 'pending' && existing.pendingEmail === email;
      if (sameSigner) return issueToken(); // resend for the original signer — no new row
      const stale = existing.status === 'pending' && Date.now() - existing.createdAt.getTime() > PENDING_TTL_MS;
      if (!stale) return reply.code(409).send({ error: 'workspace URL taken' });
      await deleteOrg(app.db, existing.id); // expired reservation — free the slug
    }

    try {
      await createPendingOrg(app.db, { name: orgName, slug, email });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: 'workspace URL taken' }); // lost a race
      throw e;
    }
    return issueToken();
  });

  app.post('/api/auth/complete', async (req, reply) => {
    if (!app.idpAdmin) return reply.code(503).send({ error: 'verification unavailable' });
    if (!limiter.tryConsume(req.ip)) return reply.code(429).header('retry-after', '60').send({ error: 'too many requests' });

    const parsed = Complete.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const v = await verifyVerifyToken(parsed.data.token, app.config.SESSION_SECRET);
    if (!v) return reply.code(400).send({ error: 'expired' });

    const org = await getOrgBySlug(app.db, v.slug);
    if (!org) return reply.code(400).send({ error: 'expired' }); // pending reservation lapsed
    const base = new URL(app.config.BASE_URL);
    const redirect = `${base.protocol}//${v.slug}.${base.host}/`;
    // Link re-click: redirect only — no session minting outside the activation
    // run, so a leaked link can't become a 24h auto-login URL after the fact.
    if (org.status === 'active') return reply.code(200).send({ ok: true, redirect });

    // Every step below checks-or-creates, so a crash mid-way is healed by retrying
    // with the same link. The tenant id is persisted BEFORE the user is created —
    // a regenerated tenant on retry would orphan the previous one.
    let tenantId = org.idpTenantId;
    if (!tenantId) {
      tenantId = (await app.idpAdmin.createTenant({ displayName: org.name })).tenantId;
      await setOrgIdpTenant(app.db, org.id, tenantId);
    }

    const found = await app.idpAdmin.findUserByEmail(tenantId, v.email);
    const userId = found?.uid
      ?? (await app.idpAdmin.createUser(tenantId, { email: v.email, password: parsed.data.password, name: v.name, emailVerified: true })).uid;

    await upsertUser(app.db, { userId, email: v.email });
    await addOrgOwner(app.db, org.id, userId);
    await activateOrg(app.db, org.id);

    // Land the founder straight in their workspace: we just created this user
    // with a verified email and their chosen password — demanding an immediate
    // manual login would re-ask for everything they typed seconds ago. No idt:
    // there is no Keycloak SSO session behind this cookie (logout handles that).
    const session = await createSessionToken({ sub: userId, email: v.email, name: v.name }, app.config.SESSION_SECRET);
    reply.setCookie(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 3600,
      ...(app.config.COOKIE_DOMAIN ? { domain: app.config.COOKIE_DOMAIN } : {}),
    });
    return reply.code(200).send({ ok: true, redirect });
  });
}
