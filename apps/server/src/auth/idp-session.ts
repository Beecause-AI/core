import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { upsertUser, getOrgBySlug } from '@intellilabs/core';
import { resolveOrg, slugFromHost } from './org-context.js';
import { createSessionToken, SESSION_COOKIE } from './session.js';
import { type IdpVerify } from '../integrations/idp/verify.js';

const Body = z.object({ idToken: z.string().min(1) });

/** Exchange a Firebase ID token (from signInWithRedirect) for an app __session,
 *  bound to the org's tenant. The SSO counterpart to /auth/password. */
export async function idpSessionRoutes(app: FastifyInstance, opts: { verify: IdpVerify }) {
  const cfg = app.config;
  const secureCookies = cfg.NODE_ENV === 'production';

  app.post('/auth/session', { preHandler: resolveOrg }, async (req, reply) => {
    const org = req.org!;
    if (!org.idpTenantId) return reply.code(503).send({ error: 'sso unavailable' });
    const { idToken } = Body.parse(req.body);

    let claims;
    try {
      claims = await opts.verify(idToken);
    } catch {
      return reply.code(401).send({ error: 'invalid token' });
    }
    // Uniform 401 with the verify failure above: don't reveal whether a valid
    // token simply belonged to a different tenant.
    if (claims.tenant !== org.idpTenantId) return reply.code(401).send({ error: 'invalid token' });
    if (!claims.emailVerified && cfg.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'email unverified' });
    }

    if (claims.email) {
      try {
        await upsertUser(app.db, { userId: claims.sub, email: claims.email });
      } catch (err) {
        req.log.warn({ err }, 'upsertUser failed, continuing with login');
      }
    }

    const session = await createSessionToken(
      { sub: claims.sub, email: claims.email, name: claims.name },
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

  // Public: the login page reads this to decide password-form vs SSO-redirect and
  // to get the tenant/provider for signInWithRedirect. tenant/provider are not secrets.
  app.get('/auth/sso-info', async (req, reply) => {
    const domain = new URL(cfg.BASE_URL).hostname;
    const slug = slugFromHost(req.headers['x-forwarded-host'] as string | undefined, domain);
    if (!slug) return reply.code(404).send({ error: 'not found' });
    const org = await getOrgBySlug(app.db, slug);
    if (!org || org.status !== 'active') return reply.code(404).send({ error: 'not found' });
    return {
      ssoEnabled: org.ssoEnabled,
      tenantId: org.ssoEnabled ? org.idpTenantId : null,
      providerId: org.ssoEnabled ? org.ssoProvider : null,
    };
  });
}
