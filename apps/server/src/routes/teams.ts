import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import JSZip from 'jszip';
import {
  getIntegration, deleteIntegration, toPublicIntegration, getIntegrationByTenantId,
  listTeamsBindings, setTeamsBinding, deleteTeamsBinding,
  listManageableProjects, getOrgById,
} from '@intellilabs/core';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin, requireOrgMember, isOrgAdminRole } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';

const PROVIDER = 'teams';

export async function teamsRoutes(app: FastifyInstance) {
  const guard = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const member = { preHandler: [resolveOrg, requireSessionUser, requireOrgMember] };

  app.get('/teams/connection', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    return reply.code(200).send(row ? toPublicIntegration(row) : null);
  });

  app.delete('/teams/connection', guard, async (req, reply) => {
    await deleteIntegration(app.db, req.org!.id, PROVIDER);
    return reply.code(204).send();
  });

  // No live API call needed: "connected" means a tenant is mapped + the bot creds are configured.
  app.post('/teams/connection/test', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    const ok = !!row && !!app.config.MICROSOFT_APP_ID;
    return reply.code(200).send({ ok, detail: ok ? undefined : 'not connected or bot not configured' });
  });

  app.get('/teams/channels', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(200).send([]);
    return reply.code(200).send(await listTeamsBindings(app.db, conn.id));
  });

  // Org-admin reassignment of an already-discovered channel (claim/discovery happens via Task 9 + project routes).
  const BindSchema = z.object({ conversationId: z.string().min(1), projectId: z.string().min(1) });
  app.post('/teams/channels', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(409).send({ error: 'teams not connected' });
    const parsed = BindSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const row = await setTeamsBinding(app.db, { orgIntegrationId: conn.id, teamsConversationId: parsed.data.conversationId, projectId: parsed.data.projectId, createdByUserId: req.user!.sub });
    return reply.code(201).send(row);
  });

  app.put<{ Params: { conversationId: string } }>('/teams/channels/:conversationId', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(409).send({ error: 'teams not connected' });
    const parsed = z.object({ projectId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const row = await setTeamsBinding(app.db, { orgIntegrationId: conn.id, teamsConversationId: req.params.conversationId, projectId: parsed.data.projectId, createdByUserId: req.user!.sub });
    return reply.code(200).send(row);
  });

  app.delete<{ Params: { conversationId: string } }>('/teams/channels/:conversationId', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(204).send();
    await deleteTeamsBinding(app.db, conn.id, req.params.conversationId);
    return reply.code(204).send();
  });

  // Connect-context for the claim page: 403 if this tenant is already mapped to a DIFFERENT org.
  app.get<{ Querystring: { tenant?: string; conversation?: string } }>('/teams/connect-context', member, async (req, reply) => {
    const tenant = req.query.tenant ?? '';
    const existing = tenant ? await getIntegrationByTenantId(app.db, tenant) : null;
    if (existing && existing.orgId !== req.org!.id) return reply.code(403).send({ error: 'tenant mapped to another org' });
    const org = await getOrgById(app.db, req.org!.id);
    const projects = await listManageableProjects(app.db, req.org!.id, req.user!.sub, isOrgAdminRole(req.orgRole));
    return reply.code(200).send({ connected: !!existing, orgName: org?.name ?? '', orgSlug: org?.slug ?? '', conversationId: req.query.conversation ?? '', projects });
  });

  // Download the Teams app package (.zip), botId substituted from config.
  app.get('/teams/manifest', guard, async (_req, reply) => {
    if (!app.config.MICROSOFT_APP_ID) return reply.code(503).send({ error: 'teams bot not configured' });
    const dir = fileURLToPath(new URL('../../teams-manifest/', import.meta.url));
    const manifest = (await readFile(`${dir}manifest.json`, 'utf8')).replaceAll('__BOT_ID__', app.config.MICROSOFT_APP_ID);
    const zip = new JSZip();
    zip.file('manifest.json', manifest);
    zip.file('color.png', await readFile(`${dir}color.png`));
    zip.file('outline.png', await readFile(`${dir}outline.png`));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="beecause-teams.zip"').send(buf);
  });
}
