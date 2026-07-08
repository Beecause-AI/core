import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserByEmail, upsertUser, setUserPassword, hashPassword, addOrgMember } from '@intellilabs/core';
import { resolveOrg } from './org-context.js';
import { createSessionToken, SESSION_COOKIE } from './session.js';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(1024),
  name: z.string().min(1).max(200).optional(),
});

/**
 * OSS single-tenant self-serve signup.
 *
 * Gated by LOCAL_SIGNUP_ENABLED=true — off by default so admin-invite remains
 * the only path for multi-tenant / managed deployments.
 *
 * Security notes:
 * - Password is NEVER logged (not even in a structured field).
 * - userId is always a fresh server-generated randomUUID; never client-supplied.
 * - Duplicate-email check happens BEFORE create; never overwrites an existing user's
 *   password hash.
 * - Cookie hardening is identical to /auth/password (httpOnly, sameSite:lax,
 *   secure in prod, path:/, 7-day maxAge, optional COOKIE_DOMAIN).
 * - Password min-8 / max-1024: min matches common policy; max caps scrypt CPU-DoS
 *   surface at the same ceiling as /auth/password.
 */
export async function registerRoutes(app: FastifyInstance) {
  const cfg = app.config;
  const secureCookies = cfg.NODE_ENV === 'production';

  app.post('/auth/register', { preHandler: resolveOrg }, async (req, reply) => {
    // Gate: disabled by default. Admin-invite is the safer default.
    if (cfg.LOCAL_SIGNUP_ENABLED !== 'true') {
      return reply.code(403).send({ error: 'signup disabled' });
    }

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    }
    const { email, password, name } = parsed.data;

    // Duplicate check BEFORE create: never overwrite an existing user's password hash.
    const existing = await getUserByEmail(app.db, email);
    if (existing) {
      return reply.code(409).send({ error: 'email already registered' });
    }

    // userId is always server-generated; never trust client input for identity.
    const userId = randomUUID();

    // Create user record and set scrypt password hash. NEVER log the password.
    await upsertUser(app.db, { userId, email, name });
    await setUserPassword(app.db, userId, hashPassword(password));

    // Add the new user to the org as a plain member (not an admin).
    await addOrgMember(app.db, req.org!.id, userId, 'user');

    // Auto-login: mint a session cookie identical to /auth/password.
    const session = await createSessionToken({ sub: userId, email, name }, cfg.SESSION_SECRET);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.setCookie(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: 7 * 24 * 3600,
      ...(cfg.COOKIE_DOMAIN ? { domain: cfg.COOKIE_DOMAIN } : {}),
    });
    return reply.code(201).send({ ok: true });
  });
}
