import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listGrafanaOrgConnections, listGrafanaConnectionsForProject, getGrafanaConnection,
  addGrafanaConnection, updateGrafanaConnection, deleteGrafanaConnection, toPublicGrafanaConnection,
  addGrafanaTarget, listGrafanaTargets, removeGrafanaTarget, grafanaTargetExists, toPublicGrafanaTarget,
  getGrafanaProjectConnection, setGrafanaProjectConnection, deleteGrafanaProjectConnection,
  grafanaCredsForConnection, grafanaAuthHeaders, discoverGrafanaDatasources, realGrafanaClient,
  type GrafanaClient, type GrafanaSignal,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface GrafanaRouteOpts { grafanaClient?: GrafanaClient; }

const normalizeBaseUrl = (v: string) => v.trim().replace(/\/+$/, '');
const tokenHint = (tok: string) => (tok.length > 4 ? `…${tok.slice(-4)}` : '…');
const buildReport = (signals: GrafanaSignal[]) => ({
  metrics: { ok: signals.includes('metrics') },
  logs: { ok: signals.includes('logs') },
  traces: { ok: signals.includes('traces') },
});

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  baseUrl: z.string().trim().url().max(500),
  token: z.string().trim().min(1),
});
const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  token: z.string().trim().min(1).optional(),
});
const TargetSchema = z.object({
  datasourceUid: z.string().trim().min(1).max(200),
  datasourceType: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
});
const BindConnectionSchema = z.object({ connectionId: z.string().trim().min(1) });

export async function grafanaRoutes(app: FastifyInstance, opts: GrafanaRouteOpts = {}) {
  const client = opts.grafanaClient ?? realGrafanaClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  /** Load a connection visible to a project: org-shared (projectId null) or owned by it. */
  const connForProject = async (orgId: string, projectId: string, connectionId: string) => {
    const conn = await getGrafanaConnection(app.db, orgId, connectionId);
    if (!conn) return null;
    if (conn.projectId === null || conn.projectId === projectId) return conn;
    return null;
  };

  /** Verify a connection: confirm the token, discover datasources, persist signals + datasources. */
  const verifyConnection = async (orgId: string, connId: string) => {
    const conn = await getGrafanaConnection(app.db, orgId, connId);
    if (!conn) return { error: 'not found' as const, code: 404 as const };
    const headers = grafanaAuthHeaders(grafanaCredsForConnection(conn, app.config));
    let org: { name?: string };
    let discovery: Awaited<ReturnType<typeof discoverGrafanaDatasources>>;
    try {
      org = await client.getOrg(conn.baseUrl, headers);
      discovery = await discoverGrafanaDatasources(client, conn.baseUrl, headers);
    } catch (err) {
      await updateGrafanaConnection(app.db, orgId, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return { error: err instanceof Error ? err.message : 'verify failed', code: 502 as const };
    }
    await updateGrafanaConnection(app.db, orgId, conn.id, {
      metadata: { ...(conn.metadata as object), grafanaOrgName: org.name, availableSignals: discovery.availableSignals, datasources: discovery.datasources },
      lastTestedAt: new Date(), lastTestOk: discovery.availableSignals.length > 0,
    });
    return { ok: true as const, report: buildReport(discovery.availableSignals), availableSignals: discovery.availableSignals, datasources: discovery.datasources };
  };

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/grafana/connections', orgAdmin, async (req) => {
    const rows = await listGrafanaOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicGrafanaConnection) };
  });

  app.post('/api/integrations/grafana/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, baseUrl, token } = parsed.data;
    const row = await addGrafanaConnection(app.db, {
      orgId: req.org!.id, projectId: null, name, mode: 'grafana', baseUrl: normalizeBaseUrl(baseUrl),
      secretCiphertext: encryptSecret(token, secretsKey()), secretHint: tokenHint(token),
      metadata: {}, createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicGrafanaConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/grafana/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, baseUrl, token } = parsed.data;
    const existing = await getGrafanaConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Parameters<typeof updateGrafanaConnection>[3] = {};
    if (name !== undefined) patch.name = name;
    if (baseUrl !== undefined) patch.baseUrl = normalizeBaseUrl(baseUrl);
    if (token !== undefined) {
      if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
      patch.secretCiphertext = encryptSecret(token, secretsKey());
      patch.secretHint = tokenHint(token);
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateGrafanaConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getGrafanaConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicGrafanaConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/grafana/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteGrafanaConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/integrations/grafana/connections/:id/verify', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const result = await verifyConnection(req.org!.id, req.params.id);
    if ('error' in result) return reply.code(result.code as number).send({ error: result.error });
    return reply.code(200).send(result);
  });

  // ── Discovery (project admin; load a connection visible to the project) ────
  app.get<{ Params: { slug: string }; Querystring: { connectionId?: string } }>('/api/org/projects/:slug/grafana/discovery/datasources', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    if (!req.query.connectionId) return reply.code(400).send({ error: 'connectionId required' });
    const conn = await connForProject(req.org!.id, req.project!.id, req.query.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    try {
      const headers = grafanaAuthHeaders(grafanaCredsForConnection(conn, app.config));
      const { datasources } = await discoverGrafanaDatasources(client, conn.baseUrl, headers);
      return { datasources };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Project connection binding (project admin) ────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/connections', projAdmin, async (req) => {
    const rows = await listGrafanaConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicGrafanaConnection) };
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/connection', projAdmin, async (req) => {
    const binding = await getGrafanaProjectConnection(app.db, req.project!.id);
    if (!binding) return { connection: null };
    const conn = await getGrafanaConnection(app.db, req.org!.id, binding.connectionId);
    return { connection: conn ? toPublicGrafanaConnection(conn) : null };
  });

  app.put<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/connection', projAdmin, async (req, reply) => {
    const parsed = BindConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { connectionId } = parsed.data;
    const visible = await listGrafanaConnectionsForProject(app.db, req.org!.id, req.project!.id);
    if (!visible.some((c) => c.id === connectionId)) return reply.code(400).send({ error: 'connection not available to this project' });
    const existing = await getGrafanaProjectConnection(app.db, req.project!.id);
    if (existing && existing.connectionId !== connectionId) {
      for (const t of await listGrafanaTargets(app.db, req.project!.id)) await removeGrafanaTarget(app.db, req.project!.id, t.id);
    }
    await setGrafanaProjectConnection(app.db, { orgId: req.org!.id, projectId: req.project!.id, connectionId, userId: req.user!.sub });
    const conn = await getGrafanaConnection(app.db, req.org!.id, connectionId);
    return reply.code(200).send({ connection: conn ? toPublicGrafanaConnection(conn) : null });
  });

  app.delete<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/connection', projAdmin, async (req, reply) => {
    for (const t of await listGrafanaTargets(app.db, req.project!.id)) await removeGrafanaTarget(app.db, req.project!.id, t.id);
    await deleteGrafanaProjectConnection(app.db, req.project!.id);
    return reply.code(204).send();
  });

  // ── Project-owned connections (project admin) ─────────────────────────────
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, baseUrl, token } = parsed.data;
    const row = await addGrafanaConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name, mode: 'grafana', baseUrl: normalizeBaseUrl(baseUrl),
      secretCiphertext: encryptSecret(token, secretsKey()), secretHint: tokenHint(token),
      metadata: {}, createdByUserId: req.user!.sub,
    });
    const existing = await getGrafanaProjectConnection(app.db, req.project!.id);
    if (existing && existing.connectionId !== row.id) {
      for (const t of await listGrafanaTargets(app.db, req.project!.id)) await removeGrafanaTarget(app.db, req.project!.id, t.id);
    }
    await setGrafanaProjectConnection(app.db, { orgId: req.org!.id, projectId: req.project!.id, connectionId: row.id, userId: req.user!.sub });
    return reply.code(200).send({ connection: toPublicGrafanaConnection(row) });
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/connection/verify', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const binding = await getGrafanaProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'no connection bound' });
    const result = await verifyConnection(req.org!.id, binding.connectionId);
    if ('error' in result) return reply.code(result.code as number).send({ error: result.error });
    return reply.code(200).send(result);
  });

  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/grafana/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getGrafanaConnection(app.db, req.org!.id, req.params.id);
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    const binding = await getGrafanaProjectConnection(app.db, req.project!.id);
    if (binding?.connectionId === conn.id) {
      for (const t of await listGrafanaTargets(app.db, req.project!.id)) await removeGrafanaTarget(app.db, req.project!.id, t.id);
      await deleteGrafanaProjectConnection(app.db, req.project!.id);
    }
    await deleteGrafanaConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  // ── Project scope resources (project admin) ───────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/targets', projAdmin, async (req) => {
    const rows = await listGrafanaTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicGrafanaTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/grafana/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { datasourceUid, datasourceType, name } = parsed.data;
    const binding = await getGrafanaProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'set a connection first' });
    if (await grafanaTargetExists(app.db, req.project!.id, datasourceUid)) {
      return reply.code(409).send({ error: 'This datasource is already in the scope' });
    }
    const row = await addGrafanaTarget(app.db, {
      projectId: req.project!.id, connectionId: binding.connectionId,
      datasourceUid, datasourceType, name, label: null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicGrafanaTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/grafana/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeGrafanaTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
