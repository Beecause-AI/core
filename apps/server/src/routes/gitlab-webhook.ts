import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  getIntegrationByWebhookTokenHash, insertIntegrationEvent,
  upsertGitlabCatalogRepo, removeGitlabCatalogRepo,
  type IntegrationMetadata, type GitlabEvents,
} from '@intellilabs/core';
import { classifyEvent, mentionsHandle } from '../integrations/gitlab/webhook.js';

const PROVIDER = 'gitlab';

export async function gitlabWebhookRoutes(app: FastifyInstance) {
  // Served on webhooks.beecause.ai → /api/gitlab (the URL the org pastes into GitLab).
  app.post('/gitlab', async (req, reply) => {
    const token = req.headers['x-gitlab-token'] as string | undefined;
    const objectKind = ((req.body ?? {}) as any)?.object_kind as string | undefined;
    const body = (req.body ?? {}) as any;
    if (!token) return reply.code(401).send({ error: 'missing token' });
    if (!objectKind) return reply.code(202).send({ ok: true });

    const hash = createHash('sha256').update(token).digest('hex');
    const conn = await getIntegrationByWebhookTokenHash(app.db, PROVIDER, hash);
    if (!conn) return reply.code(202).send({ ok: true });
    const meta = (conn.metadata as IntegrationMetadata) ?? {};
    if (!conn.enabled) return reply.code(202).send({ ok: true });

    // Project (repo) create/destroy keeps the catalog fresh.
    if (objectKind === 'project') {
      const full = body?.path_with_namespace ?? body?.project?.path_with_namespace;
      const eventName = String(body?.event_name ?? '');
      if (full && eventName === 'project_destroy') await removeGitlabCatalogRepo(app.db, conn.id, full);
      else if (full) await upsertGitlabCatalogRepo(app.db, conn.id, { repoFullName: full, defaultBranch: body?.default_branch ?? null, private: body?.visibility_level !== 20 });
      return reply.code(200).send({ ok: true });
    }

    const cls = classifyEvent(objectKind, body);
    if (!cls) return reply.code(200).send({ ok: true });
    const events: GitlabEvents = meta.gitlabEvents ?? { push: true, issues: true, mergeRequests: true };
    const enabled = cls.category === 'issues' ? events.issues : cls.category === 'merge_requests' ? events.mergeRequests : events.push;
    if (!enabled) return reply.code(200).send({ ok: true });

    // GitLab has no delivery id → synthesize a stable idempotency key.
    const repoFullName = body?.project?.path_with_namespace ?? null;
    const objId = body?.object_attributes?.id ?? body?.checkout_sha ?? body?.object_attributes?.iid ?? '';
    const deliveryId = `gitlab:${objectKind}:${body?.project?.id ?? ''}:${objId}:${body?.object_attributes?.updated_at ?? ''}`;
    await insertIntegrationEvent(app.db, {
      orgId: conn.orgId, provider: PROVIDER, category: cls.category, eventType: objectKind, action: cls.action,
      deliveryId, repoFullName, actorLogin: body?.user?.username ?? body?.user_username ?? null,
      mentionsBot: mentionsHandle(cls.commentBody, conn.accountLabel ?? ''), payload: body,
    });
    return reply.code(200).send({ ok: true });
  });
}
