import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listDatadogOrgConnections, listDatadogConnectionsForProject, getDatadogConnection,
  addDatadogConnection, updateDatadogConnection, deleteDatadogConnection, toPublicDatadogConnection,
  listDatadogTargets, addDatadogTarget, removeDatadogTarget, removeDatadogTargetsForConnection,
  datadogTargetExists, toPublicDatadogTarget,
  credsForDatadogConnection, probeDatadogSignals, realDatadogClient,
  type DatadogClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface DatadogRouteOpts { datadogClient?: DatadogClient }

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  site: z.enum(['us1', 'us3', 'us5', 'eu', 'ap1', 'us1-fed']).default('us1'),
  apiKey: z.string().trim().min(1),
  appKey: z.string().trim().min(1),
});

const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  site: z.enum(['us1', 'us3', 'us5', 'eu', 'ap1', 'us1-fed']).optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().trim().min(1).optional(),
  appKey: z.string().trim().min(1).optional(),
});

const TargetSchema = z.object({
  connectionId: z.string().trim().min(1),
  env: z.string().trim().min(1).max(200),
  service: z.string().trim().max(200).optional(),
  label: z.string().trim().max(200).optional(),
});

export async function datadogRoutes(app: FastifyInstance, opts: DatadogRouteOpts = {}) {
  const datadogClient = opts.datadogClient ?? realDatadogClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  // Build the encrypted secret + hint from apiKey + appKey.
  const buildSecret = (apiKey: string, appKey: string) => ({
    ciphertext: encryptSecret(JSON.stringify({ apiKey, appKey }), secretsKey()),
    hint: `…${appKey.slice(-4)}`,
  });

  // Resolve credentials, validate the API key, probe each signal.
  const verifyConn = async (conn: Awaited<ReturnType<typeof getDatadogConnection>>) => {
    const creds = credsForDatadogConnection(conn!, app.config);
    await datadogClient.validate(creds);
    const report = await probeDatadogSignals(datadogClient, creds);
    const signals = (['metrics', 'logs', 'traces', 'alerts'] as const).filter((s) => report[s].ok);
    return { report, signals };
  };

  const persistVerify = async (orgId: string, conn: Awaited<ReturnType<typeof getDatadogConnection>>, signals: string[]) =>
    updateDatadogConnection(app.db, orgId, conn!.id, {
      metadata: { ...(conn!.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/datadog/connections', orgAdmin, async (req) => {
    const rows = await listDatadogOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicDatadogConnection) };
  });

  app.post('/api/integrations/datadog/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.apiKey, parsed.data.appKey);
    const row = await addDatadogConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name,
      mode: 'api_keys', site: parsed.data.site,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicDatadogConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/datadog/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getDatadogConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.site !== undefined) patch.site = parsed.data.site;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    // Re-encrypt only when BOTH keys are provided
    if (parsed.data.apiKey && parsed.data.appKey) {
      const built = buildSecret(parsed.data.apiKey, parsed.data.appKey);
      patch.secretCiphertext = built.ciphertext;
      patch.secretHint = built.hint;
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateDatadogConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getDatadogConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicDatadogConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/datadog/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteDatadogConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/integrations/datadog/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getDatadogConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) {
      await updateDatadogConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });

  // ── Project scope (project admin) ─────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/datadog/connections', projAdmin, async (req) => {
    const rows = await listDatadogConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicDatadogConnection) };
  });

  // Create a PROJECT-PRIVATE connection (projectId = this project). No auto-bind/auto-target.
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/datadog/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.apiKey, parsed.data.appKey);
    const row = await addDatadogConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name: parsed.data.name,
      mode: 'api_keys', site: parsed.data.site,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicDatadogConnection(row) });
  });

  // Delete a PROJECT-PRIVATE connection only (refuses org-shared / other projects); cascades orphan target cleanup.
  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/datadog/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getDatadogConnection(app.db, req.org!.id, req.params.id);
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    await removeDatadogTargetsForConnection(app.db, req.project!.id, conn.id);
    await deleteDatadogConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/datadog/targets', projAdmin, async (req) => {
    const rows = await listDatadogTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicDatadogTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/datadog/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const visible = await listDatadogConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === parsed.data.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    const service = parsed.data.service || null;
    if (await datadogTargetExists(app.db, req.project!.id, parsed.data.env, service)) {
      return reply.code(409).send({ error: 'This env/service is already in the scope' });
    }
    const row = await addDatadogTarget(app.db, {
      projectId: req.project!.id, connectionId: conn.id, env: parsed.data.env,
      service, label: parsed.data.label ?? null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicDatadogTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/datadog/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeDatadogTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Project admins may verify a connection available to their project.
  app.post<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/datadog/connections/:id/verify', projAdmin, async (req, reply) => {
    const visible = await listDatadogConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) {
      await updateDatadogConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });
}
