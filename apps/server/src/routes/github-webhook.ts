import type { FastifyInstance } from 'fastify';
import {
  decryptSecret, keyFromBase64, getIntegrationByInstallationId,
  insertIntegrationEvent, disableIntegrationByInstallationId, type IntegrationMetadata,
  upsertCatalogRepo, removeCatalogRepo,
} from '@intellilabs/core';
import { classifyEvent, mentionsHandle, verifySignature } from '../integrations/github/webhook.js';

const PROVIDER = 'github';

export async function githubWebhookRoutes(app: FastifyInstance) {
  // Served on webhooks.beecause.ai → /api/github (matches the App's webhook URL).
  app.post('/github', async (req, reply) => {
    const raw = req.rawBody ?? '';
    const event = req.headers['x-github-event'] as string | undefined;
    const delivery = req.headers['x-github-delivery'] as string | undefined;
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    const body = (req.body ?? {}) as any;

    if (!event || !delivery) return reply.code(400).send({ error: 'missing event headers' });
    if (event === 'ping') return reply.code(200).send({ ok: true });

    const installationId = body?.installation?.id != null ? String(body.installation.id) : null;
    if (!installationId) return reply.code(202).send({ ok: true });

    const conn = await getIntegrationByInstallationId(app.db, PROVIDER, installationId);
    if (!conn) return reply.code(202).send({ ok: true });

    const meta = (conn.metadata as IntegrationMetadata) ?? {};
    let secret: string | null = null;
    if (conn.mode === 'custom_app') {
      secret = meta.webhookSecretCiphertext && app.config.SECRETS_KEY
        ? decryptSecret(meta.webhookSecretCiphertext, keyFromBase64(app.config.SECRETS_KEY)) : null;
    } else {
      secret = app.config.GITHUB_APP_WEBHOOK_SECRET ?? null;
    }
    if (!secret || !verifySignature(raw, sig, secret)) return reply.code(401).send({ error: 'bad signature' });

    if (event === 'installation' && body.action === 'deleted') {
      await disableIntegrationByInstallationId(app.db, PROVIDER, installationId);
      return reply.code(200).send({ ok: true });
    }

    // A disabled connection (e.g. after an earlier installation.deleted) captures nothing.
    if (!conn.enabled) return reply.code(202).send({ ok: true });

    if (event === 'repository' && body?.repository?.full_name) {
      const full = body.repository.full_name as string;
      const action = typeof body.action === 'string' ? body.action : '';
      if (action === 'deleted') {
        await removeCatalogRepo(app.db, conn.id, full);
      } else if (action === 'renamed' && body?.changes?.repository?.name?.from) {
        const owner = full.split('/')[0];
        await removeCatalogRepo(app.db, conn.id, `${owner}/${body.changes.repository.name.from}`);
        await upsertCatalogRepo(app.db, conn.id, { repoFullName: full, defaultBranch: body.repository.default_branch ?? null, private: !!body.repository.private });
      } else {
        await upsertCatalogRepo(app.db, conn.id, { repoFullName: full, defaultBranch: body.repository.default_branch ?? null, private: !!body.repository.private });
      }
      return reply.code(200).send({ ok: true });
    }

    const cls = classifyEvent(event, body);
    if (!cls) return reply.code(200).send({ ok: true });

    const events = meta.events ?? { issues: true, pullRequests: true, branches: true };
    const enabled = cls.category === 'issues' ? events.issues
      : cls.category === 'pull_requests' ? events.pullRequests : events.branches;
    if (!enabled) return reply.code(200).send({ ok: true });

    const handle = conn.mode === 'agent_app' ? (app.config.GITHUB_APP_SLUG ?? 'intellilabs-agent') : '';
    await insertIntegrationEvent(app.db, {
      orgId: conn.orgId, provider: PROVIDER, category: cls.category, eventType: event, action: cls.action,
      deliveryId: delivery, repoFullName: body?.repository?.full_name ?? null, actorLogin: body?.sender?.login ?? null,
      mentionsBot: mentionsHandle(cls.commentBody, handle), payload: body,
    });
    return reply.code(200).send({ ok: true });
  });
}
