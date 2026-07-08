import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createInvitation, listPendingInvitations, getInvitation, revokeInvitation, acceptInvitation,
  getOrgBySlug, getMembership, userIdByEmail, upsertUser,
} from '@intellilabs/core';
import { createInviteToken, createSessionToken, verifyInviteToken, SESSION_COOKIE } from '../auth/session.js';
import { inviteEmailHtml } from '../integrations/email/templates.js';
import { TokenBucketLimiter } from '../auth/rate-limit.js';
import { resolveOrg } from '../auth/org-context.js';
import { requireUser, requireOrgAdmin } from '../auth/guard.js';

function isUniqueViolation(e: unknown): boolean {
  const code = (e ?? {}) as { code?: string; cause?: { code?: string } };
  return code.code === '23505' || code.cause?.code === '23505';
}

const Invite = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['manager', 'user']), // 'owner' is never invitable
});
const Accept = z.object({ token: z.string().min(1), password: z.string().min(10).max(200).optional() });

const INVITE_TTL_MS = 7 * 24 * 3600_000;

// Same prod-E2E convention as signup: mail to this subdomain is suppressed, and
// the E2E runner mints the invite token itself with the session secret.
const E2E_EMAIL_RE = /@e2e\.beecause\.ai$/i;

export async function invitationRoutes(app: FastifyInstance) {
  const orgAdmin = { preHandler: [resolveOrg, requireUser, requireOrgAdmin] };
  const limiter = new TokenBucketLimiter({ capacity: 5, refillPerMs: 5 / 60_000 });

  app.get('/api/org/invitations', orgAdmin, async (req) => listPendingInvitations(app.db, req.org!.id));

  app.post('/api/org/invitations', orgAdmin, async (req, reply) => {
    if (!app.email && !app.config.AUTO_VERIFY_EMAIL) return reply.code(503).send({ error: 'invitations unavailable' });
    if (!limiter.tryConsume(req.ip)) return reply.code(429).header('retry-after', '60').send({ error: 'too many requests' });

    const parsed = Invite.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { email, role } = parsed.data;

    // Same spirit as the owner-touching rule on PATCH /api/org/members: only an
    // owner hands out org-admin power.
    if (role === 'manager' && req.orgRole !== 'owner') {
      return reply.code(403).send({ error: 'only an owner can invite managers' });
    }

    const uid = await userIdByEmail(app.db, email);
    if (uid && (await getMembership(app.db, req.org!.id, uid))) {
      return reply.code(422).send({ error: 'already a member' });
    }

    let invitation;
    try {
      invitation = await createInvitation(app.db, {
        orgId: req.org!.id, email, role, invitedBy: req.user!.sub,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(422).send({ error: 'already invited' });
      throw e;
    }

    const token = await createInviteToken(
      { slug: req.org!.slug, email, invitationId: invitation.id }, app.config.SESSION_SECRET,
    );
    if (app.config.AUTO_VERIFY_EMAIL) {
      // Dev/e2e shortcut: hand the token back instead of emailing it.
      return reply.code(200).send({ ok: true, token });
    }
    if (!E2E_EMAIL_RE.test(email)) {
      const base = new URL(app.config.BASE_URL);
      await app.email!.send({
        to: email, subject: `You've been invited to ${req.org!.name} on Beecause`,
        html: inviteEmailHtml({
          inviterEmail: req.user!.email ?? 'An administrator', orgName: req.org!.name, role,
          // The accept page must live on the org host: acceptance provisions the
          // user in that org's Identity Platform tenant and the session cookie is minted there.
          url: `${base.protocol}//${req.org!.slug}.${base.host}/accept-invite?token=${token}`,
        }),
      });
    }
    return reply.code(200).send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>('/api/org/invitations/:id', orgAdmin, async (req, reply) => {
    if (!z.string().min(1).safeParse(req.params.id).success) return reply.code(404).send({ error: 'not found' });
    const ok = await revokeInvitation(app.db, req.org!.id, req.params.id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });

  // No org guard: the invitee is not a member yet. Mirrors /api/auth/complete —
  // the emailed JWT is the credential, and every dead-end answers a uniform
  // 400 'expired' so the endpoint doesn't enumerate invitation state.
  app.post('/api/auth/accept-invite', async (req, reply) => {
    if (!app.idpAdmin) return reply.code(503).send({ error: 'invitations unavailable' });
    if (!limiter.tryConsume(req.ip)) return reply.code(429).header('retry-after', '60').send({ error: 'too many requests' });

    const parsed = Accept.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const v = await verifyInviteToken(parsed.data.token, app.config.SESSION_SECRET);
    if (!v) return reply.code(400).send({ error: 'expired' });

    const org = await getOrgBySlug(app.db, v.slug);
    if (!org || org.status !== 'active') return reply.code(400).send({ error: 'expired' });
    // An org with no Identity Platform tenant can't provision the invitee.
    if (!org.idpTenantId) return reply.code(503).send({ error: 'invitations unavailable' });
    const tenantId = org.idpTenantId;
    const invitation = await getInvitation(app.db, v.invitationId);
    if (!invitation || invitation.orgId !== org.id || invitation.status !== 'pending') {
      return reply.code(400).send({ error: 'expired' });
    }

    // Re-invited users (or anyone who already has an IdP account in this tenant)
    // keep their existing password — the field is only required when we must
    // create the user.
    const found = await app.idpAdmin.findUserByEmail(tenantId, v.email);
    let userId = found?.uid;
    if (!userId) {
      if (!parsed.data.password) return reply.code(400).send({ error: 'password required' });
      userId = (await app.idpAdmin.createUser(tenantId, {
        email: v.email, password: parsed.data.password,
        name: v.email.split('@')[0] ?? v.email, emailVerified: true,
      })).uid;
    }

    await upsertUser(app.db, { userId, email: v.email });
    const ok = await acceptInvitation(app.db, invitation.id, userId);
    if (!ok) return reply.code(400).send({ error: 'expired' }); // raced a revoke/expiry

    const base = new URL(app.config.BASE_URL);
    const redirect = `${base.protocol}//${v.slug}.${base.host}/`;
    // Auto-login, same rationale as signup completion: the user proved email
    // ownership seconds ago. No idt — no KC SSO session backs this cookie.
    const session = await createSessionToken({ sub: userId, email: v.email }, app.config.SESSION_SECRET);
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
