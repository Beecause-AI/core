import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listDynatraceOrgConnections, listDynatraceConnectionsForProject, getDynatraceConnection,
  addDynatraceConnection, updateDynatraceConnection, deleteDynatraceConnection, toPublicDynatraceConnection,
  listDynatraceTargets, addDynatraceTarget, removeDynatraceTarget, removeDynatraceTargetsForConnection,
  dynatraceTargetExists, toPublicDynatraceTarget,
  credsForDynatraceConnection, probeDynatraceSignals, realDynatraceClient,
  type DynatraceClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface DynatraceRouteOpts { dynatraceClient?: DynatraceClient }

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  environmentUrl: z.string().trim().url(),
  apiToken: z.string().trim().min(1),
});

const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  environmentUrl: z.string().trim().url().optional(),
  enabled: z.boolean().optional(),
  apiToken: z.string().trim().min(1).optional(),
});

const TargetSchema = z.object({
  connectionId: z.string().min(1),
  managementZone: z.string().trim().min(1).optional(),
  service: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
}).refine((v) => v.managementZone || v.service, { message: 'managementZone or service is required' });

export async function dynatraceRoutes(app: FastifyInstance, opts: DynatraceRouteOpts = {}) {
  const dynatraceClient = opts.dynatraceClient ?? realDynatraceClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  // Build the encrypted secret + hint from apiToken.
  const buildSecret = (apiToken: string) => ({
    ciphertext: encryptSecret(apiToken, secretsKey()),
    hint: `…${apiToken.slice(-4)}`,
  });

  // Resolve credentials, validate the API token, probe each signal.
  const verifyConn = async (conn: Awaited<ReturnType<typeof getDynatraceConnection>>) => {
    const creds = credsForDynatraceConnection(conn!, app.config);
    await dynatraceClient.validate(creds);
    const report = await probeDynatraceSignals(dynatraceClient, creds);
    const signals = (['metrics', 'logs', 'problems'] as const).filter((s) => report[s].ok);
    return { report, signals };
  };

  const persistVerify = async (orgId: string, conn: Awaited<ReturnType<typeof getDynatraceConnection>>, signals: string[]) =>
    updateDynatraceConnection(app.db, orgId, conn!.id, {
      metadata: { ...(conn!.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/dynatrace/connections', orgAdmin, async (req) => {
    const rows = await listDynatraceOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicDynatraceConnection) };
  });

  app.post('/api/integrations/dynatrace/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.apiToken);
    const row = await addDynatraceConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name,
      mode: 'api_token', environmentUrl: parsed.data.environmentUrl,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicDynatraceConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/dynatrace/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getDynatraceConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.environmentUrl !== undefined) patch.environmentUrl = parsed.data.environmentUrl;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    // Re-encrypt only when apiToken is provided
    if (parsed.data.apiToken) {
      const built = buildSecret(parsed.data.apiToken);
      patch.secretCiphertext = built.ciphertext;
      patch.secretHint = built.hint;
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateDynatraceConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getDynatraceConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicDynatraceConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/dynatrace/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteDynatraceConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/integrations/dynatrace/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getDynatraceConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) {
      await updateDynatraceConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });

  // ── Project scope (project admin) ─────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/dynatrace/connections', projAdmin, async (req) => {
    const rows = await listDynatraceConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicDynatraceConnection) };
  });

  // Create a PROJECT-PRIVATE connection (projectId = this project). No auto-bind/auto-target.
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/dynatrace/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.apiToken);
    const row = await addDynatraceConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name: parsed.data.name,
      mode: 'api_token', environmentUrl: parsed.data.environmentUrl,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicDynatraceConnection(row) });
  });

  // Delete a PROJECT-PRIVATE connection only (refuses org-shared / other projects); cascades orphan target cleanup.
  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/dynatrace/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getDynatraceConnection(app.db, req.org!.id, req.params.id);
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    await removeDynatraceTargetsForConnection(app.db, req.project!.id, conn.id);
    await deleteDynatraceConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/dynatrace/targets', projAdmin, async (req) => {
    const rows = await listDynatraceTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicDynatraceTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/dynatrace/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const visible = await listDynatraceConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === parsed.data.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    const managementZone = parsed.data.managementZone || null;
    const service = parsed.data.service || null;
    if (await dynatraceTargetExists(app.db, req.project!.id, managementZone, service)) {
      return reply.code(409).send({ error: 'This managementZone/service is already in the scope' });
    }
    const row = await addDynatraceTarget(app.db, {
      projectId: req.project!.id, connectionId: conn.id,
      managementZone, service, label: parsed.data.label ?? null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicDynatraceTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/dynatrace/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeDynatraceTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Project admins may verify a connection available to their project.
  app.post<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/dynatrace/connections/:id/verify', projAdmin, async (req, reply) => {
    const visible = await listDynatraceConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) {
      await updateDynatraceConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });
}
