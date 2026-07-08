import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listOrgConnections, listConnectionsForProject, getConnection,
  addConnection, updateConnection, deleteConnection, toPublicCloudflareConnection,
  addCloudflareTarget, listCloudflareTargets, removeCloudflareTarget,
  cloudflareTargetExists, toPublicCloudflareTarget,
  getProjectConnection, setProjectConnection, deleteProjectConnection,
  cfCredsForConnection, cfAuthHeaders, cfProbeSignals, realCloudflareClient,
  type CloudflareClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface CloudflareRouteOpts { cloudflareClient?: CloudflareClient; }

const Creds = {
  mode: z.enum(['api_token', 'global_key']),
  apiToken: z.string().min(1).optional(),
  email: z.string().email().optional(),
  apiKey: z.string().min(1).optional(),
};

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: z.string().trim().max(200).optional(),
  ...Creds,
});
const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  accountId: z.string().trim().max(200).optional(),
  mode: z.enum(['api_token', 'global_key']).optional(),
  apiToken: z.string().min(1).optional(),
  email: z.string().email().optional(),
  apiKey: z.string().min(1).optional(),
});
// A project's scope resource: an allowed zone or account (no creds — the project's bound connection is used).
const TargetSchema = z.object({
  kind: z.enum(['account', 'zone']),
  accountId: z.string().trim().min(1),
  zoneId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(200),
});
// Bind a project to one Cloudflare connection.
const BindConnectionSchema = z.object({
  connectionId: z.string().trim().min(1),
});

export async function cloudflareRoutes(app: FastifyInstance, opts: CloudflareRouteOpts = {}) {
  const client = opts.cloudflareClient ?? realCloudflareClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  const encryptModeSecret = (
    mode: 'api_token' | 'global_key',
    v: { apiToken?: string; email?: string; apiKey?: string },
  ): { ciphertext: string } | { missing: string } => {
    if (mode === 'api_token') {
      if (!v.apiToken) return { missing: 'apiToken required' };
      return { ciphertext: encryptSecret(v.apiToken, secretsKey()) };
    }
    if (!v.email || !v.apiKey) return { missing: 'email and apiKey required' };
    return { ciphertext: encryptSecret(JSON.stringify({ email: v.email, apiKey: v.apiKey }), secretsKey()) };
  };

  /** Load a connection visible to a project: org-shared (projectId null) or owned by it. */
  const connForProject = async (orgId: string, projectId: string, connectionId: string) => {
    const conn = await getConnection(app.db, orgId, connectionId);
    if (!conn) return null;
    if (conn.projectId === null || conn.projectId === projectId) return conn;
    return null;
  };

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/cloudflare/connections', orgAdmin, async (req) => {
    const rows = await listOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicCloudflareConnection) };
  });

  app.post('/api/integrations/cloudflare/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { mode, accountId } = parsed.data;
    // API tokens are scoped to a single account whose id is shown on the token page.
    if (mode === 'api_token' && !accountId) return reply.code(400).send({ error: 'accountId is required for an API Token connection' });
    const enc = encryptModeSecret(mode, parsed.data);
    if ('missing' in enc) return reply.code(400).send({ error: enc.missing });
    const metadata = accountId ? { accountId } : {};
    const row = await addConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name,
      mode, secretCiphertext: enc.ciphertext, metadata, createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicCloudflareConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/cloudflare/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, mode, apiToken, email, apiKey, accountId } = parsed.data;
    const hasCredentials = apiToken !== undefined || email !== undefined || apiKey !== undefined;
    const patch: { name?: string; mode?: 'api_token' | 'global_key'; secretCiphertext?: string; metadata?: { accountId?: string } } = {};
    if (name !== undefined) patch.name = name;
    if (accountId !== undefined) {
      patch.metadata = { accountId: accountId || undefined };
    }
    if (mode !== undefined && !hasCredentials) {
      return reply.code(400).send({ error: 'changing mode requires new credentials' });
    }
    if (hasCredentials) {
      if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
      let effectiveMode = mode;
      if (effectiveMode === undefined) {
        const existing = await getConnection(app.db, req.org!.id, req.params.id);
        if (!existing) return reply.code(404).send({ error: 'not found' });
        effectiveMode = existing.mode as 'api_token' | 'global_key';
      }
      const enc = encryptModeSecret(effectiveMode, parsed.data);
      if ('missing' in enc) return reply.code(400).send({ error: enc.missing });
      patch.secretCiphertext = enc.ciphertext;
      if (mode !== undefined) patch.mode = mode;
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'nothing to update' });
    }
    const ok = await updateConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicCloudflareConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/cloudflare/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Probe the connection's account per signal and persist availableSignals (tool gating reads these).
  app.post<{ Params: { id: string } }>('/api/integrations/cloudflare/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    const accountId = (conn.metadata as { accountId?: string }).accountId;
    if (!accountId) return reply.code(400).send({ error: 'connection has no account id to verify against' });
    const headers = cfAuthHeaders(cfCredsForConnection(conn, app.config));
    let report;
    try {
      report = await cfProbeSignals(client, headers, { kind: 'account', accountTag: accountId });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    const signals = (['analytics', 'logs', 'workers'] as const).filter((s) => report[s].ok);
    await updateConnection(app.db, req.org!.id, req.params.id, {
      metadata: { ...(conn.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });
    return reply.code(200).send({ report, availableSignals: signals });
  });

  // ── Discovery (project admin; loads a connection visible to the project) ───
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/connections', projAdmin, async (req) => {
    const rows = await listConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicCloudflareConnection) };
  });

  app.get<{ Params: { slug: string }; Querystring: { connectionId?: string } }>('/api/org/projects/:slug/cloudflare/discovery/accounts', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    if (!req.query.connectionId) return reply.code(400).send({ error: 'connectionId required' });
    const conn = await connForProject(req.org!.id, req.project!.id, req.query.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    try { return await client.listAccounts(cfAuthHeaders(cfCredsForConnection(conn, app.config))); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }
  });

  app.get<{ Params: { slug: string }; Querystring: { connectionId?: string; accountId?: string } }>('/api/org/projects/:slug/cloudflare/discovery/zones', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    if (!req.query.connectionId) return reply.code(400).send({ error: 'connectionId required' });
    const conn = await connForProject(req.org!.id, req.project!.id, req.query.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    try { return await client.listZones(cfAuthHeaders(cfCredsForConnection(conn, app.config)), req.query.accountId); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }
  });

  app.get<{ Params: { slug: string }; Querystring: { connectionId?: string; accountId?: string } }>('/api/org/projects/:slug/cloudflare/discovery/worker-scripts', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    if (!req.query.connectionId) return reply.code(400).send({ error: 'connectionId required' });
    if (!req.query.accountId) return reply.code(400).send({ error: 'accountId required' });
    const conn = await connForProject(req.org!.id, req.project!.id, req.query.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    try { return await client.listWorkerScripts(cfAuthHeaders(cfCredsForConnection(conn, app.config)), req.query.accountId); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }
  });

  // ── Project connection binding (project admin) ────────────────────────────
  // A project binds to exactly one Cloudflare connection; its scope = the targets below.
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/connection', projAdmin, async (req) => {
    const binding = await getProjectConnection(app.db, req.project!.id);
    if (!binding) return { connection: null };
    const conn = await getConnection(app.db, req.org!.id, binding.connectionId);
    return { connection: conn ? toPublicCloudflareConnection(conn) : null };
  });

  // A project admin may verify the connection their project is bound to.
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/connection/verify', projAdmin, async (req, reply) => {
    const binding = await getProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'no connection bound' });
    const conn = await getConnection(app.db, req.org!.id, binding.connectionId);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    const accountId = (conn.metadata as { accountId?: string }).accountId;
    if (!accountId) return reply.code(400).send({ error: 'connection has no account id to verify against' });
    const headers = cfAuthHeaders(cfCredsForConnection(conn, app.config));
    let report;
    try {
      report = await cfProbeSignals(client, headers, { kind: 'account', accountTag: accountId });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    const signals = (['analytics', 'logs', 'workers'] as const).filter((s) => report[s].ok);
    await updateConnection(app.db, req.org!.id, conn.id, {
      metadata: { ...(conn.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });
    return reply.code(200).send({ report, availableSignals: signals });
  });

  app.put<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/connection', projAdmin, async (req, reply) => {
    const parsed = BindConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { connectionId } = parsed.data;
    const visible = await listConnectionsForProject(app.db, req.org!.id, req.project!.id);
    if (!visible.some((c) => c.id === connectionId)) {
      return reply.code(400).send({ error: 'connection not available to this project' });
    }
    // Switching connections invalidates the old connection's scope resources.
    const existing = await getProjectConnection(app.db, req.project!.id);
    if (existing && existing.connectionId !== connectionId) {
      for (const t of await listCloudflareTargets(app.db, req.project!.id)) {
        await removeCloudflareTarget(app.db, req.project!.id, t.id);
      }
    }
    await setProjectConnection(app.db, { orgId: req.org!.id, projectId: req.project!.id, connectionId, userId: req.user!.sub });
    const conn = await getConnection(app.db, req.org!.id, connectionId);
    return reply.code(200).send({ connection: conn ? toPublicCloudflareConnection(conn) : null });
  });

  app.delete<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/connection', projAdmin, async (req, reply) => {
    for (const t of await listCloudflareTargets(app.db, req.project!.id)) {
      await removeCloudflareTarget(app.db, req.project!.id, t.id);
    }
    await deleteProjectConnection(app.db, req.project!.id);
    return reply.code(204).send();
  });

  // ── Project scope resources (project admin) ───────────────────────────────
  // Empty scope = unrestricted (the connection's token is the boundary).
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/targets', projAdmin, async (req) => {
    const rows = await listCloudflareTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicCloudflareTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/cloudflare/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { kind, accountId, zoneId, name } = parsed.data;
    if (kind === 'zone' && !zoneId) return reply.code(400).send({ error: 'zoneId required for a zone target' });

    const binding = await getProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'set a connection first' });

    if (await cloudflareTargetExists(app.db, req.project!.id, kind, accountId, zoneId ?? null)) {
      return reply.code(409).send({ error: `This ${kind} is already in the scope` });
    }

    const row = await addCloudflareTarget(app.db, {
      projectId: req.project!.id, connectionId: binding.connectionId, kind, accountId, zoneId: zoneId ?? null,
      name, label: null, metadata: {}, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicCloudflareTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/cloudflare/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeCloudflareTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
