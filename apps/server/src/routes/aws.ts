import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listAwsOrgConnections, listAwsConnectionsForProject, getAwsConnection,
  addAwsConnection, updateAwsConnection, deleteAwsConnection, toPublicAwsConnection,
  listAwsTargets, addAwsTarget, removeAwsTarget, awsTargetExists, toPublicAwsTarget,
  credsForAwsConnection, resolveAwsCreds, accountFromRoleArn, probeAwsSignals, realAwsClient,
  type AwsClient,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

export interface AwsRouteOpts { awsClient?: AwsClient }

const CreateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mode: z.enum(['access_key', 'assume_role']),
  defaultRegion: z.string().trim().min(1).max(64),
  accessKeyId: z.string().trim().min(1).optional(),
  secretAccessKey: z.string().trim().min(1).optional(),
  roleArn: z.string().trim().min(1).optional(),
});
const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  defaultRegion: z.string().trim().min(1).max(64).optional(),
  accessKeyId: z.string().trim().min(1).optional(),
  secretAccessKey: z.string().trim().min(1).optional(),
  roleArn: z.string().trim().min(1).optional(),
});
const TargetSchema = z.object({
  connectionId: z.string().trim().min(1),
  region: z.string().trim().min(1).max(64),
  label: z.string().trim().max(200).optional(),
});

export async function awsRoutes(app: FastifyInstance, opts: AwsRouteOpts = {}) {
  const awsClient = opts.awsClient ?? realAwsClient;
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  // Build the encrypted secret + hint + derived fields for create/patch.
  const buildSecret = (mode: 'access_key' | 'assume_role', v: { accessKeyId?: string; secretAccessKey?: string; roleArn?: string }) => {
    if (mode === 'access_key') {
      if (!v.accessKeyId || !v.secretAccessKey) return { missing: 'accessKeyId and secretAccessKey are required' as const };
      const ciphertext = encryptSecret(JSON.stringify({ accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey }), secretsKey());
      return { ciphertext, hint: `…${v.accessKeyId.slice(-4)}`, roleArn: null, externalId: null, awsAccountId: null };
    }
    if (!v.roleArn) return { missing: 'roleArn is required' as const };
    return { ciphertext: '', hint: v.roleArn, roleArn: v.roleArn, externalId: randomUUID(), awsAccountId: accountFromRoleArn(v.roleArn) };
  };

  // Resolve creds, confirm account via GetCallerIdentity, probe each signal.
  const verifyConn = async (conn: Awaited<ReturnType<typeof getAwsConnection>>) => {
    const creds = credsForAwsConnection(conn!, app.config);
    const resolved = await resolveAwsCreds(creds, conn!.defaultRegion, app.config);
    const ident = await awsClient.getCallerIdentity(resolved, conn!.defaultRegion);
    const report = await probeAwsSignals(awsClient, resolved, conn!.defaultRegion);
    const signals = (['metrics', 'logs', 'traces', 'alarms'] as const).filter((s) => report[s].ok);
    return { report, signals, accountId: ident.accountId ?? conn!.awsAccountId };
  };

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/aws/connections', orgAdmin, async (req) => {
    const rows = await listAwsOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicAwsConnection) };
  });

  app.post('/api/integrations/aws/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.mode, parsed.data);
    if ('missing' in built) return reply.code(400).send({ error: built.missing });
    const row = await addAwsConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name, mode: parsed.data.mode,
      defaultRegion: parsed.data.defaultRegion, awsAccountId: built.awsAccountId,
      roleArn: built.roleArn, externalId: built.externalId,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicAwsConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/aws/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getAwsConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.defaultRegion !== undefined) patch.defaultRegion = parsed.data.defaultRegion;
    if (existing.mode === 'access_key' && (parsed.data.accessKeyId || parsed.data.secretAccessKey)) {
      const built = buildSecret('access_key', parsed.data);
      if ('missing' in built) return reply.code(400).send({ error: built.missing });
      patch.secretCiphertext = built.ciphertext; patch.secretHint = built.hint;
    }
    if (existing.mode === 'assume_role' && parsed.data.roleArn) {
      patch.roleArn = parsed.data.roleArn; patch.secretHint = parsed.data.roleArn;
      patch.awsAccountId = accountFromRoleArn(parsed.data.roleArn);
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateAwsConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getAwsConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicAwsConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/aws/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteAwsConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/integrations/aws/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getAwsConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) { return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' }); }
    await updateAwsConnection(app.db, req.org!.id, conn.id, {
      metadata: { ...(conn.metadata as object), availableSignals: result.signals },
      awsAccountId: result.accountId, lastTestedAt: new Date(), lastTestOk: result.signals.length > 0,
    });
    return reply.code(200).send({ report: result.report, availableSignals: result.signals, awsAccountId: result.accountId });
  });

  // ── Project scope (project admin) ─────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/aws/connections', projAdmin, async (req) => {
    const rows = await listAwsConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicAwsConnection) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/aws/connections', projAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const built = buildSecret(parsed.data.mode, parsed.data);
    if ('missing' in built) return reply.code(400).send({ error: built.missing });
    const row = await addAwsConnection(app.db, {
      orgId: req.org!.id, projectId: req.project!.id, name: parsed.data.name, mode: parsed.data.mode,
      defaultRegion: parsed.data.defaultRegion, awsAccountId: built.awsAccountId,
      roleArn: built.roleArn, externalId: built.externalId,
      secretCiphertext: built.ciphertext, secretHint: built.hint,
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicAwsConnection(row) });
  });

  app.delete<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/aws/connections/:id', projAdmin, async (req, reply) => {
    const conn = await getAwsConnection(app.db, req.org!.id, req.params.id);
    // Only project-owned connections may be deleted here; org-shared (projectId null) and other projects' → 404.
    if (!conn || conn.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    // Remove any of this project's targets that reference the connection so nothing is orphaned.
    for (const t of await listAwsTargets(app.db, req.project!.id)) {
      if (t.connectionId === conn.id) await removeAwsTarget(app.db, req.project!.id, t.id);
    }
    await deleteAwsConnection(app.db, req.org!.id, conn.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/aws/targets', projAdmin, async (req) => {
    const rows = await listAwsTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicAwsTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/aws/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const visible = await listAwsConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === parsed.data.connectionId);
    if (!conn) return reply.code(400).send({ error: 'connection not available to this project' });
    if (!conn.awsAccountId) return reply.code(400).send({ error: 'verify the connection first so its AWS account id is known' });
    if (await awsTargetExists(app.db, req.project!.id, conn.awsAccountId, parsed.data.region)) {
      return reply.code(409).send({ error: 'This account/region is already in the scope' });
    }
    const row = await addAwsTarget(app.db, {
      projectId: req.project!.id, connectionId: conn.id, awsAccountId: conn.awsAccountId,
      awsRegion: parsed.data.region, label: parsed.data.label ?? null, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicAwsTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/aws/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeAwsTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Project admins may verify a connection available to their project.
  app.post<{ Params: { slug: string; id: string } }>('/api/org/projects/:slug/aws/connections/:id/verify', projAdmin, async (req, reply) => {
    const visible = await listAwsConnectionsForProject(app.db, req.org!.id, req.project!.id);
    const conn = visible.find((c) => c.id === req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let result;
    try { result = await verifyConn(conn); }
    catch (err) { return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' }); }
    await updateAwsConnection(app.db, req.org!.id, conn.id, {
      metadata: { ...(conn.metadata as object), availableSignals: result.signals },
      awsAccountId: result.accountId, lastTestedAt: new Date(), lastTestOk: result.signals.length > 0,
    });
    return reply.code(200).send({ report: result.report, availableSignals: result.signals, awsAccountId: result.accountId });
  });
}
