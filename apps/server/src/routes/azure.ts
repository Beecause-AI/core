import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listAzureOrgConnections, listAzureConnectionsForProject, getAzureConnection,
  addAzureConnection, updateAzureConnection, deleteAzureConnection, toPublicAzureConnection,
  listAzureTargets, addAzureTarget, removeAzureTarget, removeAzureTargetsForConnection,
  azureTargetExists, toPublicAzureTarget,
  credsForAzureConnection, resolveAzureCredential, probeAzureSignals, realAzureClient,
  type AzureClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface AzureRouteOpts { azureClient?: AzureClient }

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mode: z.enum(['service_principal', 'workload_identity']),
  tenantId: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).optional(),
  defaultSubscriptionId: z.string().trim().min(1).max(200),
  defaultWorkspaceId: z.string().trim().max(200).optional(),
});
const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  clientSecret: z.string().trim().min(1).optional(),
  defaultSubscriptionId: z.string().trim().min(1).max(200).optional(),
  defaultWorkspaceId: z.string().trim().max(200).optional(),
});
const TargetSchema = z.object({
  connectionId: z.string().trim().min(1),
  subscriptionId: z.string().trim().min(1).max(200),
  workspaceId: z.string().trim().max(200).optional(),
  region: z.string().trim().max(64).optional(),
  label: z.string().trim().max(200).optional(),
});

export async function azureRoutes(app: FastifyInstance, opts: AzureRouteOpts = {}) {
  const azureClient = opts.azureClient ?? realAzureClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  // Build the encrypted secret + hint + federationSubject for a create.
  const buildSecret = (mode: 'service_principal' | 'workload_identity', clientId: string, clientSecret?: string) => {
    if (mode === 'service_principal') {
      if (!clientSecret) return { missing: 'clientSecret is required for service_principal' as const };
      return { ciphertext: encryptSecret(clientSecret, secretsKey()), hint: `…${clientId.slice(-4)}`, federationSubject: null as string | null };
    }
    return { ciphertext: '', hint: null as string | null, federationSubject: randomUUID() };
  };

  // Resolve a credential, confirm it mints a token, probe each signal against the connection's default scope.
  const verifyConn = async (conn: Awaited<ReturnType<typeof getAzureConnection>>) => {
    const cred = resolveAzureCredential(credsForAzureConnection(conn!, app.config), app.config);
    await azureClient.checkCredential(cred);
    const report = await probeAzureSignals(azureClient, cred, { subscriptionId: conn!.defaultSubscriptionId, workspaceId: conn!.defaultWorkspaceId });
    const signals = (['metrics', 'logs', 'traces', 'alerts'] as const).filter((s) => report[s].ok);
    return { report, signals };
  };

  const persistVerify = async (orgId: string, conn: Awaited<ReturnType<typeof getAzureConnection>>, signals: string[]) =>
    updateAzureConnection(app.db, orgId, conn!.id, {
      metadata: { ...(conn!.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/azure/connections', orgAdmin, async (req) => {
    const rows = await listAzureOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicAzureConnection) };
  });

  app.post('/api/integrations/azure/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.mode, parsed.data.clientId, parsed.data.clientSecret);
    if ('missing' in built) return reply.code(400).send({ error: built.missing });
    const row = await addAzureConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name, mode: parsed.data.mode,
      tenantId: parsed.data.tenantId, clientId: parsed.data.clientId,
      secretCiphertext: built.ciphertext, secretHint: built.hint, federationSubject: built.federationSubject,
      defaultSubscriptionId: parsed.data.defaultSubscriptionId, defaultWorkspaceId: parsed.data.defaultWorkspaceId ?? null,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicAzureConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/azure/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getAzureConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.defaultSubscriptionId !== undefined) patch.defaultSubscriptionId = parsed.data.defaultSubscriptionId;
    if (parsed.data.defaultWorkspaceId !== undefined) patch.defaultWorkspaceId = parsed.data.defaultWorkspaceId || null;
    if (existing.mode === 'service_principal' && parsed.data.clientSecret) {
      patch.secretCiphertext = encryptSecret(parsed.data.clientSecret, secretsKey());
      patch.secretHint = `…${existing.clientId.slice(-4)}`;
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateAzureConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getAzureConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicAzureConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/azure/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteAzureConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/integrations/azure/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getAzureConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) { return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' }); }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });

  // ── Project scope (project admin) ─────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/azure/connections', projAdmin, async (req) => {
    const rows = await listAzureConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicAzureConnection) };
  });

  // Create a PROJECT-PRIVATE connection (projectId = this project). No auto-bind/auto-target.
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/azure/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.mode, parsed.data.clientId, parsed.data.clientSecret);
    if ('missing' in built) return reply.code(400).send({ error: built.missing });
    const row = await addAzureConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name: parsed.data.name, mode: parsed.data.mode,
      tenantId: parsed.data.tenantId, clientId: parsed.data.clientId,
      secretCiphertext: built.ciphertext, secretHint: built.hint, federationSubject: built.federationSubject,
      defaultSubscriptionId: parsed.data.defaultSubscriptionId, defaultWorkspaceId: parsed.data.defaultWorkspaceId ?? null,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicAzureConnection(row) });
  });

  // Delete a PROJECT-PRIVATE connection only (refuses org-shared / other projects); removes orphan targets first.
  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/azure/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getAzureConnection(app.db, req.org!.id, req.params.id);
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    await removeAzureTargetsForConnection(app.db, req.project!.id, conn.id);
    await deleteAzureConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/azure/targets', projAdmin, async (req) => {
    const rows = await listAzureTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicAzureTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/azure/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const visible = await listAzureConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === parsed.data.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    const workspaceId = parsed.data.workspaceId || null;
    if (await azureTargetExists(app.db, req.project!.id, parsed.data.subscriptionId, workspaceId)) {
      return reply.code(409).send({ error: 'This subscription/workspace is already in the scope' });
    }
    const row = await addAzureTarget(app.db, {
      projectId: req.project!.id, connectionId: conn.id, subscriptionId: parsed.data.subscriptionId,
      logAnalyticsWorkspaceId: workspaceId, region: parsed.data.region ?? null,
      label: parsed.data.label ?? null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicAzureTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/azure/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeAzureTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Project admins may verify a connection available to their project.
  app.post<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/azure/connections/:id/verify', projAdmin, async (req, reply) => {
    const visible = await listAzureConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) { return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' }); }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });
}
