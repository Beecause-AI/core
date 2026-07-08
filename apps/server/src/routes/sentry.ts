import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listSentryOrgConnections, listSentryConnectionsForProject, getSentryConnection,
  addSentryConnection, updateSentryConnection, deleteSentryConnection, toPublicSentryConnection,
  addSentryTarget, listSentryTargets, removeSentryTarget, sentryTargetExists, toPublicSentryTarget,
  getSentryProjectConnection, setSentryProjectConnection, deleteSentryProjectConnection,
  sentryCredsForConnection, sentryAuthHeaders, realSentryClient,
  type SentryClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface SentryRouteOpts { sentryClient?: SentryClient; }

const DEFAULT_BASE_URL = 'https://sentry.io';
const normalizeBaseUrl = (v?: string) => (v && v.trim() ? v.trim().replace(/\/+$/, '') : DEFAULT_BASE_URL);
const tokenHint = (tok: string) => (tok.length > 4 ? `…${tok.slice(-4)}` : '…');

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sentryOrgSlug: z.string().trim().min(1).max(200),
  baseUrl: z.string().trim().url().max(500).optional(),
  authToken: z.string().trim().min(1),
});
const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sentryOrgSlug: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  authToken: z.string().trim().min(1).optional(),
});
// A project's scope resource: an allowed Sentry project (no creds — the bound connection is used).
const TargetSchema = z.object({
  sentryProjectSlug: z.string().trim().min(1).max(200),
  sentryProjectId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
});
const BindConnectionSchema = z.object({ connectionId: z.string().trim().min(1) });

export async function sentryRoutes(app: FastifyInstance, opts: SentryRouteOpts = {}) {
  const client = opts.sentryClient ?? realSentryClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  /** Load a connection visible to a project: org-shared (projectId null) or owned by it. */
  const connForProject = async (orgId: string, projectId: string, connectionId: string) => {
    const conn = await getSentryConnection(app.db, orgId, connectionId);
    if (!conn) return null;
    if (conn.projectId === null || conn.projectId === projectId) return conn;
    return null;
  };

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/sentry/connections', orgAdmin, async (req) => {
    const rows = await listSentryOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicSentryConnection) };
  });

  app.post('/api/integrations/sentry/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, sentryOrgSlug, authToken } = parsed.data;
    const row = await addSentryConnection(app.db, {
      orgId: req.org!.id, projectId: null, name, mode: 'auth_token',
      baseUrl: normalizeBaseUrl(parsed.data.baseUrl),
      secretCiphertext: encryptSecret(authToken, secretsKey()), secretHint: tokenHint(authToken),
      metadata: { sentryOrgSlug }, createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicSentryConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/sentry/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, sentryOrgSlug, baseUrl, authToken } = parsed.data;
    const existing = await getSentryConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });

    const patch: Parameters<typeof updateSentryConnection>[3] = {};
    if (name !== undefined) patch.name = name;
    if (baseUrl !== undefined) patch.baseUrl = normalizeBaseUrl(baseUrl);
    if (sentryOrgSlug !== undefined) {
      patch.metadata = { ...(existing.metadata as object), sentryOrgSlug };
    }
    if (authToken !== undefined) {
      if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
      patch.secretCiphertext = encryptSecret(authToken, secretsKey());
      patch.secretHint = tokenHint(authToken);
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateSentryConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getSentryConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicSentryConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/sentry/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteSentryConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Verify a connection's token + org slug by fetching the organization.
  app.post<{ Params: { id: string } }>('/api/integrations/sentry/connections/:id/test', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const conn = await getSentryConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    const orgSlug = (conn.metadata as { sentryOrgSlug?: string }).sentryOrgSlug;
    if (!orgSlug) return reply.code(400).send({ error: 'connection has no organization slug' });
    const headers = sentryAuthHeaders(sentryCredsForConnection(conn, app.config));
    try {
      await client.getOrganization(conn.baseUrl, headers, orgSlug);
    } catch (err) {
      await updateSentryConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'test failed' });
    }
    await updateSentryConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: true });
    return reply.code(200).send({ ok: true });
  });

  // ── Discovery (project admin; loads a connection visible to the project) ───
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/connections', projAdmin, async (req) => {
    const rows = await listSentryConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicSentryConnection) };
  });

  app.get<{ Params: { slug: string }; Querystring: { connectionId?: string } }>('/api/org/projects/:slug/sentry/discovery/projects', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    if (!req.query.connectionId) return reply.code(400).send({ error: 'connectionId required' });
    const conn = await connForProject(req.org!.id, req.project!.id, req.query.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    const orgSlug = (conn.metadata as { sentryOrgSlug?: string }).sentryOrgSlug;
    if (!orgSlug) return reply.code(400).send({ error: 'connection has no organization slug' });
    try {
      const raw = await client.listProjects(conn.baseUrl, sentryAuthHeaders(sentryCredsForConnection(conn, app.config)), orgSlug);
      const projects = (Array.isArray(raw) ? raw : []).map((p: any) => ({ id: String(p.id), slug: String(p.slug), name: String(p.name ?? p.slug) }));
      return { projects };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Project connection binding (project admin) ────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/connection', projAdmin, async (req) => {
    const binding = await getSentryProjectConnection(app.db, req.project!.id);
    if (!binding) return { connection: null };
    const conn = await getSentryConnection(app.db, req.org!.id, binding.connectionId);
    return { connection: conn ? toPublicSentryConnection(conn) : null };
  });

  app.put<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/connection', projAdmin, async (req, reply) => {
    const parsed = BindConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { connectionId } = parsed.data;
    const visible = await listSentryConnectionsForProject(app.db, req.org!.id, req.project!.id);
    if (!visible.some((c) => c.id === connectionId)) {
      return reply.code(400).send({ error: 'connection not available to this project' });
    }
    // Switching connections invalidates the old connection's scope resources.
    const existing = await getSentryProjectConnection(app.db, req.project!.id);
    if (existing && existing.connectionId !== connectionId) {
      for (const t of await listSentryTargets(app.db, req.project!.id)) {
        await removeSentryTarget(app.db, req.project!.id, t.id);
      }
    }
    await setSentryProjectConnection(app.db, { orgId: req.org!.id, projectId: req.project!.id, connectionId, userId: req.user!.sub });
    const conn = await getSentryConnection(app.db, req.org!.id, connectionId);
    return reply.code(200).send({ connection: conn ? toPublicSentryConnection(conn) : null });
  });

  app.delete<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/connection', projAdmin, async (req, reply) => {
    for (const t of await listSentryTargets(app.db, req.project!.id)) {
      await removeSentryTarget(app.db, req.project!.id, t.id);
    }
    await deleteSentryProjectConnection(app.db, req.project!.id);
    return reply.code(204).send();
  });

  // ── Project-owned connections (project admin) ─────────────────────────────
  // A project admin can create a connection directly from the project page. It is
  // project-OWNED (projectId set) — private to this project, never org-shared — and
  // is auto-bound on create (switching from another connection clears its scope).
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, sentryOrgSlug, authToken } = parsed.data;
    const row = await addSentryConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name, mode: 'auth_token',
      baseUrl: normalizeBaseUrl(parsed.data.baseUrl),
      secretCiphertext: encryptSecret(authToken, secretsKey()), secretHint: tokenHint(authToken),
      metadata: { sentryOrgSlug }, createdByUserId: req.user!.sub,
    });
    // Auto-bind. Switching from a different connection invalidates the old scope.
    const existing = await getSentryProjectConnection(app.db, req.project!.id);
    if (existing && existing.connectionId !== row.id) {
      for (const t of await listSentryTargets(app.db, req.project!.id)) {
        await removeSentryTarget(app.db, req.project!.id, t.id);
      }
    }
    await setSentryProjectConnection(app.db, { orgId: req.org!.id, projectId: req.project!.id, connectionId: row.id, userId: req.user!.sub });
    return reply.code(200).send({ connection: toPublicSentryConnection(row) });
  });

  // Test the connection the project is bound to (project admin — the org test
  // endpoint requires org admin, which a project admin may not be).
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/connection/test', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const binding = await getSentryProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'no connection bound' });
    const conn = await getSentryConnection(app.db, req.org!.id, binding.connectionId);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    const orgSlug = (conn.metadata as { sentryOrgSlug?: string }).sentryOrgSlug;
    if (!orgSlug) return reply.code(400).send({ error: 'connection has no organization slug' });
    const headers = sentryAuthHeaders(sentryCredsForConnection(conn, app.config));
    try {
      await client.getOrganization(conn.baseUrl, headers, orgSlug);
    } catch (err) {
      await updateSentryConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'test failed' });
    }
    await updateSentryConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: true });
    return reply.code(200).send({ ok: true });
  });

  // Delete a connection OWNED by this project (project admin). Org-shared connections
  // (projectId null) are managed at the org level and cannot be removed here. If the
  // deleted connection is the bound one, unbind + clear scope first.
  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/sentry/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getSentryConnection(app.db, req.org!.id, req.params.id);
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    const binding = await getSentryProjectConnection(app.db, req.project!.id);
    if (binding?.connectionId === conn.id) {
      for (const t of await listSentryTargets(app.db, req.project!.id)) {
        await removeSentryTarget(app.db, req.project!.id, t.id);
      }
      await deleteSentryProjectConnection(app.db, req.project!.id);
    }
    await deleteSentryConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  // ── Project scope resources (project admin) ───────────────────────────────
  // Empty scope = unrestricted (the connection's token is the boundary).
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/targets', projAdmin, async (req) => {
    const rows = await listSentryTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicSentryTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/sentry/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { sentryProjectSlug, sentryProjectId, name } = parsed.data;

    const binding = await getSentryProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'set a connection first' });

    if (await sentryTargetExists(app.db, req.project!.id, sentryProjectSlug)) {
      return reply.code(409).send({ error: 'This project is already in the scope' });
    }

    const row = await addSentryTarget(app.db, {
      projectId: req.project!.id, connectionId: binding.connectionId,
      sentryProjectSlug, sentryProjectId, name, label: null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicSentryTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/sentry/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeSentryTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
