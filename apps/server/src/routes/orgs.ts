import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listOrgsForUser } from '@intellilabs/core';
import { requireUser, requireOrgMember } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';
import { createSessionToken, SESSION_COOKIE } from '../auth/session.js';

const ProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

export async function orgRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireUser }, async (req) => req.user);

  app.get('/orgs', { preHandler: requireUser }, async (req) =>
    listOrgsForUser(app.db, req.user!.sub),
  );

  // Profile name edit. Identity Platform is the source of truth (the org's tenant);
  // after a successful write we re-issue the session cookie so the new name shows
  // immediately without a re-login.
  app.patch('/me/profile', { preHandler: [resolveOrg, requireUser, requireOrgMember] }, async (req, reply) => {
    if (!app.idpAdmin || !req.org!.idpTenantId) return reply.code(503).send({ error: 'profile unavailable' });
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const { firstName, lastName } = parsed.data;

    await app.idpAdmin.updateUser(req.org!.idpTenantId, req.user!.sub, { firstName, lastName });

    const name = `${firstName} ${lastName}`.trim();
    const session = await createSessionToken(
      { sub: req.user!.sub, email: req.user!.email, name, idt: req.user!.idt },
      app.config.SESSION_SECRET,
    );
    reply.setCookie(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 3600,
      ...(app.config.COOKIE_DOMAIN ? { domain: app.config.COOKIE_DOMAIN } : {}),
    });
    return { name, firstName, lastName };
  });

  // No POST /orgs: orgs are founded exclusively via signup — each org is its own
  // Keycloak realm, so in-app creation would mint a workspace nobody can log into.
}
