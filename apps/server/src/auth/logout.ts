import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE } from './session.js';

/** Session-clearing logout (Keycloak-free). Clears both cookie variants and
 *  returns to the workspace root, where the SPA bounces to /signin. */
export async function logoutRoutes(app: FastifyInstance) {
  const cfg = app.config;
  app.get('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (cfg.COOKIE_DOMAIN) reply.clearCookie(SESSION_COOKIE, { path: '/', domain: cfg.COOKIE_DOMAIN });
    return reply.redirect('/');
  });
}
