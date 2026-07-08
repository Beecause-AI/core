import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { upsertUser } from '@intellilabs/core';
import { resolveOrg } from './org-context.js';
import { createSessionToken, SESSION_COOKIE } from './session.js';
import { InvalidCredentialsError } from './provider.js';

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(1024) });

/** Server-side email/password sign-in. Delegates to the app's configured AuthProvider
 *  (GCP Identity Platform in SaaS mode, or local scrypt in OSS mode). Mints the same
 *  __session cookie as the OIDC callback. */
export async function passwordAuthRoutes(app: FastifyInstance) {
  const cfg = app.config;
  const secureCookies = cfg.NODE_ENV === 'production';

  app.post('/auth/password', { preHandler: resolveOrg }, async (req, reply) => {
    const org = req.org!;
    const { email, password } = Body.parse(req.body);

    let result: { userId: string; email?: string; name?: string };
    try {
      result = await app.authProvider!.authenticate({ org, email, password });
    } catch (e) {
      if (e instanceof InvalidCredentialsError) return reply.code(401).send({ error: 'invalid credentials' });
      throw e;
    }

    if (result.email) {
      try {
        await upsertUser(app.db, { userId: result.userId, email: result.email });
      } catch (err) {
        req.log.warn({ err }, 'upsertUser failed, continuing with login');
      }
    }

    const session = await createSessionToken(
      { sub: result.userId, email: result.email, name: result.name },
      cfg.SESSION_SECRET,
    );
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.setCookie(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: 7 * 24 * 3600,
      ...(cfg.COOKIE_DOMAIN ? { domain: cfg.COOKIE_DOMAIN } : {}),
    });
    return reply.send({ ok: true });
  });
}
