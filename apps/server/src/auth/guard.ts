import type { FastifyReply, FastifyRequest } from 'fastify';
import { getMembership, getProjectBySlug, getProjectRole } from '@intellilabs/core';
import { findActiveApiKeyByHash, hashApiKey, touchApiKeyLastUsed } from '@intellilabs/core';
import { sessionFromCookieHeader } from './session.js';
import type { SessionUser } from './session.js';

/**
 * Authenticate via a personal API key in the Authorization header. The key
 * always authenticates as its owning user. Behaviour depends on the route:
 *
 *  - User-scoped (apex) routes such as /api/me and /api/orgs do not resolve an
 *    org, so req.org is unset and NO org check is applied — the key is accepted
 *    purely as its owner. Keys are NOT rejected on these routes.
 *  - Org-scoped routes run resolveOrg first (req.org set); keys are single-org,
 *    so the key's org must match req.org or it is rejected here.
 *
 * Returns the acting user, or null to fall through to other auth.
 */
async function userFromApiKey(req: FastifyRequest): Promise<SessionUser | null> {
  const auth = req.headers.authorization;
  // bee_ = current keys, ilk_ = legacy (pre-Beecause) keys still in the wild.
  if (!auth?.startsWith('Bearer bee_') && !auth?.startsWith('Bearer ilk_')) return null;
  const token = auth.slice('Bearer '.length);
  // A DB error here deliberately propagates to the global error handler (→ 500),
  // matching the cookie path. We do NOT swallow infra errors as 401, which would
  // mask outages as auth failures.
  const key = await findActiveApiKeyByHash(req.server.db, hashApiKey(token));
  if (!key) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  if (req.org && req.org.id !== key.orgId) return null; // key not valid for this org
  // Best-effort per-request write (acceptable for v1; could be throttled later
  // if it becomes hot). Errors are swallowed so they never block the request.
  void touchApiKeyLastUsed(req.server.db, key.id).catch(() => {}); // best-effort; don't block the request
  return { sub: key.userId };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  // Scan ALL __session values: a stale host-only txn cookie can ride along with
  // the Domain-wide session cookie and req.cookies would keep only one of them.
  const cookieUser = await sessionFromCookieHeader(req.headers.cookie, req.server.config.SESSION_SECRET);
  if (cookieUser) {
    req.user = cookieUser;
    return;
  }
  const keyUser = await userFromApiKey(req);
  if (keyUser) {
    req.user = keyUser;
    return;
  }
  return reply.code(401).send({ error: 'unauthenticated' });
}

/** preHandler for routes under /orgs/:orgId — run AFTER requireUser. 404 hides org existence. */
export async function requireMember(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
  const { orgId } = req.params as { orgId: string };
  const membership = await getMembership(req.server.db, orgId, req.user.sub);
  if (!membership) return reply.code(404).send({ error: 'not found' });
}

/** Pure helper — true if the role is org-level admin (owner or manager). */
export function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

/** Requires req.org set (resolveOrg ran) and req.user a member; else 404. Attaches req.orgRole. */
export async function requireOrgMember(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
  if (!req.org) return reply.code(404).send({ error: 'not found' });
  const m = await getMembership(req.server.db, req.org.id, req.user.sub);
  if (!m) return reply.code(404).send({ error: 'not found' });
  req.orgRole = m.role;
}

export async function requireOrgAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireOrgMember(req, reply);
  if (reply.sent) return;
  if (!isOrgAdminRole(req.orgRole)) return reply.code(404).send({ error: 'not found' });
}

/** Project member OR org admin. Reads :projectId from params, scoped to req.org. */
export function requireProjectMember(req: FastifyRequest, reply: FastifyReply) {
  return projectGuard(req, reply, 'member');
}

export function requireProjectAdmin(req: FastifyRequest, reply: FastifyReply) {
  return projectGuard(req, reply, 'admin');
}

async function projectGuard(req: FastifyRequest, reply: FastifyReply, need: 'member' | 'admin') {
  await requireOrgMember(req, reply);
  if (reply.sent) return;
  const { slug } = req.params as { slug?: string };
  if (!slug) return reply.code(404).send({ error: 'not found' });
  const project = await getProjectBySlug(req.server.db, req.org!.id, slug);
  if (!project) return reply.code(404).send({ error: 'not found' });
  const orgAdmin = isOrgAdminRole(req.orgRole);
  const projRole = orgAdmin ? 'admin' : await getProjectRole(req.server.db, project.id, req.user!.sub);
  if (!projRole) return reply.code(404).send({ error: 'not found' });
  if (need === 'admin' && projRole !== 'admin') return reply.code(404).send({ error: 'not found' });
  req.project = project;
  req.projectRole = projRole;
}
