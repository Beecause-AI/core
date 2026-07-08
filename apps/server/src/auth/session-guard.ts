import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionFromCookieHeader } from './session.js';

/** Cookie-session-only auth. Unlike requireUser, it NEVER accepts an API key — used by
 *  UI-only endpoints (e.g. model-key management) to keep them off the public API surface. */
export async function requireSessionUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await sessionFromCookieHeader(req.headers.cookie, req.server.config.SESSION_SECRET);
  if (!user) return reply.code(401).send({ error: 'unauthenticated' });
  req.user = user;
}
