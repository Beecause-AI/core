import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listPagerDutyOrgConnections, listPagerDutyConnectionsForProject, getPagerDutyConnection,
  addPagerDutyConnection, updatePagerDutyConnection, deletePagerDutyConnection, toPublicPagerDutyConnection,
  listPagerDutyTargets, addPagerDutyTarget, removePagerDutyTarget, removePagerDutyTargetsForConnection,
  pagerdutyTargetExists, toPublicPagerDutyTarget,
  credsForPagerDutyConnection, probePagerDutySignals, realPagerDutyClient,
  type PagerDutyClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface PagerDutyRouteOpts { pagerdutyClient?: PagerDutyClient }

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  region: z.enum(['us', 'eu']).default('us'),
  apiToken: z.string().trim().min(1),
});

const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  region: z.enum(['us', 'eu']).optional(),
  enabled: z.boolean().optional(),
  apiToken: z.string().trim().min(1).optional(),
});

const TargetSchema = z.object({
  connectionId: z.string().trim().min(1),
  teamId: z.string().trim().max(200).optional(),
  teamName: z.string().trim().max(200).optional(),
  serviceId: z.string().trim().max(200).optional(),
  serviceName: z.string().trim().max(200).optional(),
  label: z.string().trim().max(200).optional(),
}).refine((d) => d.teamId || d.serviceId, { message: 'a target needs a team or a service' });

export async function pagerdutyRoutes(app: FastifyInstance, opts: PagerDutyRouteOpts = {}) {
  const pagerdutyClient = opts.pagerdutyClient ?? realPagerDutyClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  // Build the encrypted secret + hint from a single apiToken.
  const buildSecret = (apiToken: string) => ({
    ciphertext: encryptSecret(apiToken, secretsKey()),
    hint: `…${apiToken.slice(-4)}`,
  });

  // Resolve credentials, validate the API token, probe each signal.
  const verifyConn = async (conn: Awaited<ReturnType<typeof getPagerDutyConnection>>) => {
    const creds = credsForPagerDutyConnection(conn!, app.config);
    const report = await probePagerDutySignals(pagerdutyClient, creds);
    const signals = (['alerts'] as const).filter((s) => report[s].ok);
    return { report, signals };
  };

  const persistVerify = async (orgId: string, conn: Awaited<ReturnType<typeof getPagerDutyConnection>>, signals: string[]) =>
    updatePagerDutyConnection(app.db, orgId, conn!.id, {
      metadata: { ...(conn!.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/pagerduty/connections', orgAdmin, async (req) => {
    const rows = await listPagerDutyOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicPagerDutyConnection) };
  });

  app.post('/api/integrations/pagerduty/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.apiToken);
    const row = await addPagerDutyConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name,
      mode: 'api_keys', region: parsed.data.region,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicPagerDutyConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/pagerduty/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getPagerDutyConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.region !== undefined) patch.region = parsed.data.region;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    // Re-encrypt when a new token is provided
    if (parsed.data.apiToken) {
      const built = buildSecret(parsed.data.apiToken);
      patch.secretCiphertext = built.ciphertext;
      patch.secretHint = built.hint;
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updatePagerDutyConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getPagerDutyConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicPagerDutyConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/pagerduty/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deletePagerDutyConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/integrations/pagerduty/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getPagerDutyConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) {
      await updatePagerDutyConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });

  // ── Project scope (project admin) ─────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/pagerduty/connections', projAdmin, async (req) => {
    const rows = await listPagerDutyConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicPagerDutyConnection) };
  });

  // Create a PROJECT-PRIVATE connection (projectId = this project). No auto-bind/auto-target.
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/pagerduty/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.apiToken);
    const row = await addPagerDutyConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name: parsed.data.name,
      mode: 'api_keys', region: parsed.data.region,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicPagerDutyConnection(row) });
  });

  // Delete a PROJECT-PRIVATE connection only (refuses org-shared / other projects); cascades orphan target cleanup.
  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/pagerduty/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getPagerDutyConnection(app.db, req.org!.id, req.params.id);
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    await removePagerDutyTargetsForConnection(app.db, req.project!.id, conn.id);
    await deletePagerDutyConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/pagerduty/targets', projAdmin, async (req) => {
    const rows = await listPagerDutyTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicPagerDutyTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/pagerduty/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const visible = await listPagerDutyConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === parsed.data.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    const team = parsed.data.teamId || null;
    const service = parsed.data.serviceId || null;
    if (await pagerdutyTargetExists(app.db, req.project!.id, team, service)) {
      return reply.code(409).send({ error: 'This team/service is already in the scope' });
    }
    const row = await addPagerDutyTarget(app.db, {
      projectId: req.project!.id, connectionId: conn.id,
      teamId: team, teamName: parsed.data.teamName ?? null,
      serviceId: service, serviceName: parsed.data.serviceName ?? null,
      label: parsed.data.label ?? null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicPagerDutyTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/pagerduty/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removePagerDutyTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Project admins may verify a connection available to their project.
  app.post<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/pagerduty/connections/:id/verify', projAdmin, async (req, reply) => {
    const visible = await listPagerDutyConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) {
      await updatePagerDutyConnection(app.db, req.org!.id, conn.id, { lastTestedAt: new Date(), lastTestOk: false });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    await persistVerify(req.org!.id, conn, result.signals);
    return reply.code(200).send({ report: result.report, availableSignals: result.signals });
  });
}
