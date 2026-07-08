import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, keyFromBase64,
  listGcpOrgConnections, listGcpConnectionsForProject, getGcpConnection,
  addGcpConnection, updateGcpConnection, deleteGcpConnection, toPublicGcpConnection,
  getGcpProjectConnection, setGcpProjectConnection, deleteGcpProjectConnection,
  listGcpTargets, addGcpTarget, removeGcpTarget, gcpTargetExists, toPublicGcpTarget,
  credsForConnection, mintToken as realMintToken, GCP_READONLY_SCOPES, GCP_ERRORREPORTING_SCOPES, probeSignals, realGcpClient,
  type GcpClient, type GcpCreds,
} from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireProjectAdmin } from '../auth/guard.js';

type MintToken = (creds: GcpCreds, scopes: string[]) => Promise<string>;

export interface GcpRouteOpts {
  gcpClient?: GcpClient;
  /** Injectable token minter; defaults to the real (network-backed) implementation. */
  mintToken?: MintToken;
}

const Creds = { mode: z.enum(['sa_key', 'wif']), saKey: z.string().min(1).optional(), wifConfig: z.string().min(1).optional() };
const CreateConnectionSchema = z.object({ name: z.string().trim().min(1).max(200), defaultGcpProjectId: z.string().trim().min(1).max(200), ...Creds });
const PatchConnectionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  defaultGcpProjectId: z.string().trim().max(200).optional(),
  mode: z.enum(['sa_key', 'wif']).optional(),
  saKey: z.string().min(1).optional(), wifConfig: z.string().min(1).optional(),
});
const TargetSchema = z.object({ gcpProjectId: z.string().trim().min(1).max(200), label: z.string().trim().max(200).optional() });
const BindConnectionSchema = z.object({ connectionId: z.string().trim().min(1) });

export async function gcpRoutes(app: FastifyInstance, opts: GcpRouteOpts = {}) {
  const gcpClient = opts.gcpClient ?? realGcpClient;
  const mintToken: MintToken = opts.mintToken ?? ((creds, scopes) => realMintToken(creds, scopes));
  const orgAdmin = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const projAdmin = { preHandler: [resolveOrg, requireSessionUser, requireProjectAdmin] };
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  /**
   * Pick saKey/wifConfig by mode, encrypt it, and derive a display hint (SA email
   * for sa_key, 'wif' for wif). Returns `{ missing }` when the chosen secret is absent.
   */
  const encryptModeSecret = (
    mode: 'sa_key' | 'wif', v: { saKey?: string; wifConfig?: string },
  ): { ciphertext: string; hint: string } | { missing: string } => {
    if (mode === 'sa_key') {
      if (!v.saKey) return { missing: 'saKey required' };
      let hint = '';
      try { hint = (JSON.parse(v.saKey) as { client_email?: string }).client_email ?? ''; } catch { /* keep '' */ }
      return { ciphertext: encryptSecret(v.saKey, secretsKey()), hint };
    }
    if (!v.wifConfig) return { missing: 'wifConfig required' };
    return { ciphertext: encryptSecret(v.wifConfig, secretsKey()), hint: 'wif' };
  };

  /** Mint a token and probe each signal; threads the (stubbable) client. The probe
   *  covers Error Reporting too, which only accepts the cloud-platform scope — a
   *  superset of the read scopes, so every signal is still probed under the service
   *  account's real IAM (a missing role still 403s its signal). */
  const probe = async (creds: GcpCreds, gcpProjectId: string) => {
    const token = await mintToken(creds, [...GCP_READONLY_SCOPES, ...GCP_ERRORREPORTING_SCOPES]);
    return probeSignals(gcpClient, token, gcpProjectId);
  };

  // ── Org connections (org admin) ───────────────────────────────────────────
  app.get('/api/integrations/gcp/connections', orgAdmin, async (req) => {
    const rows = await listGcpOrgConnections(app.db, req.org!.id);
    return { connections: rows.map(toPublicGcpConnection) };
  });

  app.post('/api/integrations/gcp/connections', orgAdmin, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CreateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const enc = encryptModeSecret(parsed.data.mode, parsed.data);
    if ('missing' in enc) return reply.code(400).send({ error: enc.missing });
    const row = await addGcpConnection(app.db, {
      orgId: req.org!.id, projectId: null, name: parsed.data.name, mode: parsed.data.mode,
      secretCiphertext: enc.ciphertext, secretHint: enc.hint,
      metadata: { defaultGcpProjectId: parsed.data.defaultGcpProjectId, saEmail: enc.hint || undefined },
      createdByUserId: req.user!.sub,
    });
    return reply.code(200).send({ connection: toPublicGcpConnection(row) });
  });

  app.patch<{ Params: { id: string } }>('/api/integrations/gcp/connections/:id', orgAdmin, async (req, reply) => {
    const parsed = PatchConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { name, mode, saKey, wifConfig, defaultGcpProjectId } = parsed.data;
    const hasCredentials = saKey !== undefined || wifConfig !== undefined;
    const existing = await getGcpConnection(app.db, req.org!.id, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (defaultGcpProjectId !== undefined) {
      patch.metadata = { ...(existing.metadata as object), defaultGcpProjectId: defaultGcpProjectId || undefined };
    }
    if (mode !== undefined && !hasCredentials) return reply.code(400).send({ error: 'changing mode requires new credentials' });
    if (hasCredentials) {
      if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
      const effectiveMode = mode ?? (existing.mode as 'sa_key' | 'wif');
      const enc = encryptModeSecret(effectiveMode, parsed.data);
      if ('missing' in enc) return reply.code(400).send({ error: enc.missing });
      patch.secretCiphertext = enc.ciphertext;
      patch.secretHint = enc.hint;
      if (mode !== undefined) patch.mode = mode;
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    const ok = await updateGcpConnection(app.db, req.org!.id, req.params.id, patch);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    const row = await getGcpConnection(app.db, req.org!.id, req.params.id);
    return reply.code(200).send({ connection: toPublicGcpConnection(row!) });
  });

  app.delete<{ Params: { id: string } }>('/api/integrations/gcp/connections/:id', orgAdmin, async (req, reply) => {
    const ok = await deleteGcpConnection(app.db, req.org!.id, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Verify the connection's default project and persist availableSignals (tool gating reads these).
  app.post<{ Params: { id: string } }>('/api/integrations/gcp/connections/:id/verify', orgAdmin, async (req, reply) => {
    const conn = await getGcpConnection(app.db, req.org!.id, req.params.id);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    const gcpProject = (conn.metadata as { defaultGcpProjectId?: string })?.defaultGcpProjectId;
    if (!gcpProject) return reply.code(400).send({ error: 'connection has no default GCP project to verify against' });
    const creds = credsForConnection(conn, app.config);
    let report;
    try {
      report = await probe(creds, gcpProject);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    const signals = (['monitoring', 'logging', 'trace', 'errors'] as const).filter((s) => report[s].ok);
    await updateGcpConnection(app.db, req.org!.id, req.params.id, {
      metadata: { ...(conn.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });
    return reply.code(200).send({ report, availableSignals: signals });
  });

  // ── Project binding + scope (project admin) ───────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/connections', projAdmin, async (req) => {
    const rows = await listGcpConnectionsForProject(app.db, req.org!.id, req.project!.id);
    return { connections: rows.map(toPublicGcpConnection) };
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/connection', projAdmin, async (req) => {
    const binding = await getGcpProjectConnection(app.db, req.project!.id);
    if (!binding) return { connection: null };
    const conn = await getGcpConnection(app.db, req.org!.id, binding.connectionId);
    return { connection: conn ? toPublicGcpConnection(conn) : null };
  });

  // A project admin may verify the connection their project is bound to.
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/connection/verify', projAdmin, async (req, reply) => {
    const binding = await getGcpProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'no connection bound' });
    const conn = await getGcpConnection(app.db, req.org!.id, binding.connectionId);
    if (!conn) return reply.code(404).send({ error: 'not found' });
    let gcpProject = (conn.metadata as { defaultGcpProjectId?: string }).defaultGcpProjectId;
    if (!gcpProject) {
      const targets = await listGcpTargets(app.db, req.project!.id);
      gcpProject = targets[0]?.gcpProjectId;
    }
    if (!gcpProject) {
      return reply.code(400).send({ error: 'no GCP project to verify against — add a project to the scope or set the connection default project' });
    }
    const creds = credsForConnection(conn, app.config);
    let report;
    try {
      report = await probe(creds, gcpProject);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'verify failed' });
    }
    const signals = (['monitoring', 'logging', 'trace', 'errors'] as const).filter((s) => report[s].ok);
    await updateGcpConnection(app.db, req.org!.id, conn.id, {
      metadata: { ...(conn.metadata as object), availableSignals: signals },
      lastTestedAt: new Date(), lastTestOk: signals.length > 0,
    });
    return reply.code(200).send({ report, availableSignals: signals });
  });

  app.put<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/connection', projAdmin, async (req, reply) => {
    const parsed = BindConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { connectionId } = parsed.data;
    const visible = await listGcpConnectionsForProject(app.db, req.org!.id, req.project!.id);
    if (!visible.some((c) => c.id === connectionId)) return reply.code(400).send({ error: 'connection not available to this project' });
    // Switching connections invalidates the old connection's scope resources.
    const existing = await getGcpProjectConnection(app.db, req.project!.id);
    if (existing && existing.connectionId !== connectionId) {
      for (const target of await listGcpTargets(app.db, req.project!.id)) await removeGcpTarget(app.db, req.project!.id, target.id);
    }
    await setGcpProjectConnection(app.db, { orgId: req.org!.id, projectId: req.project!.id, connectionId, userId: req.user!.sub });
    const conn = await getGcpConnection(app.db, req.org!.id, connectionId);
    return reply.code(200).send({ connection: conn ? toPublicGcpConnection(conn) : null });
  });

  app.delete<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/connection', projAdmin, async (req, reply) => {
    for (const target of await listGcpTargets(app.db, req.project!.id)) await removeGcpTarget(app.db, req.project!.id, target.id);
    await deleteGcpProjectConnection(app.db, req.project!.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/targets', projAdmin, async (req) => {
    const rows = await listGcpTargets(app.db, req.project!.id);
    return { targets: rows.map(toPublicGcpTarget) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/gcp/targets', projAdmin, async (req, reply) => {
    const parsed = TargetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const binding = await getGcpProjectConnection(app.db, req.project!.id);
    if (!binding) return reply.code(400).send({ error: 'set a connection first' });
    if (await gcpTargetExists(app.db, req.project!.id, parsed.data.gcpProjectId)) {
      return reply.code(409).send({ error: 'This GCP project is already in the scope' });
    }
    const row = await addGcpTarget(app.db, {
      projectId: req.project!.id, connectionId: binding.connectionId,
      gcpProjectId: parsed.data.gcpProjectId, label: parsed.data.label ?? null,
      metadata: {}, addedByUserId: req.user!.sub,
    });
    return reply.code(200).send({ target: toPublicGcpTarget(row) });
  });

  app.delete<{ Params: { slug: string; targetId: string } }>('/api/org/projects/:slug/gcp/targets/:targetId', projAdmin, async (req, reply) => {
    const ok = await removeGcpTarget(app.db, req.project!.id, req.params.targetId);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // Discovery: list GCP projects reachable by the connection's SA (manual-entry fallback in UI on 403).
  app.get<{ Params: { slug: string }; Querystring: { connectionId?: string } }>(
    '/api/org/projects/:slug/gcp/discovery/projects', projAdmin, async (req, reply) => {
      if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
      const connectionId = req.query.connectionId;
      if (!connectionId) return reply.code(400).send({ error: 'connectionId required' });
      const conn = await getGcpConnection(app.db, req.org!.id, connectionId);
      if (!conn || (conn.projectId !== null && conn.projectId !== req.project!.id)) {
        return reply.code(400).send({ error: 'connection not available to this project' });
      }
      try {
        const creds = credsForConnection(conn, app.config);
        const token = await mintToken(creds, GCP_READONLY_SCOPES);
        const result = await gcpClient.listProjects(token);
        return { result };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'discovery failed' });
      }
    });
}
