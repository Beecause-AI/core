import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import {
  encryptSecret, decryptSecret, keyFromBase64,
  upsertIntegration, getIntegration, setIntegrationTested,
  setGitlabIntegrationEvents, setIntegrationIssuesEnabled, deleteIntegration, toPublicIntegration,
  gitlabCredsForRow, type IntegrationMetadata,
} from '@intellilabs/core';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';
import { assertSafeBaseUrl } from '../security/ssrf.js';
import { realGitlabClient, type GitlabClient } from '../integrations/gitlab/client.js';

const PROVIDER = 'gitlab';
const DEFAULT_EVENTS = { push: true, issues: true, mergeRequests: true };

const TokenSchema = z.object({ token: z.string().trim().min(8).max(400), baseUrl: z.string().trim().max(400).optional() });
const EventsSchema = z.object({ push: z.boolean().optional(), issues: z.boolean().optional(), mergeRequests: z.boolean().optional() });

export interface GitlabRouteOpts { client?: GitlabClient; }

export async function gitlabRoutes(app: FastifyInstance, opts: GitlabRouteOpts = {}) {
  const client = opts.client ?? realGitlabClient;
  const guard = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const hint = (k: string) => `…${k.slice(-4)}`;
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);
  const cfg = () => ({ SECRETS_KEY: app.config.SECRETS_KEY });
  const webhookUrl = () => `https://webhooks.${new URL(app.config.BASE_URL).hostname}/api/gitlab`;

  app.get('/gitlab/connection', guard, async (req) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    return row ? toPublicIntegration(row) : null;
  });

  app.put('/gitlab/connection/token', guard, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = TokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { token, baseUrl } = parsed.data;
    if (baseUrl) { try { assertSafeBaseUrl(baseUrl); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); } }
    const result = await client.probe({ token, baseUrl });
    if (!result.ok) return reply.code(400).send({ error: 'token rejected', detail: result.detail });

    // Preserve an existing webhook secret across re-saves so the org needn't re-paste it.
    const existing = await getIntegration(app.db, req.org!.id, PROVIDER);
    const existingMeta = (existing?.metadata as IntegrationMetadata) ?? {};
    let webhookSecretCiphertext = existingMeta.webhookSecretCiphertext;
    let webhookTokenHash = existingMeta.webhookTokenHash;
    if (!webhookSecretCiphertext || !webhookTokenHash) {
      const secret = randomBytes(24).toString('base64url');
      webhookSecretCiphertext = encryptSecret(secret, secretsKey());
      webhookTokenHash = createHash('sha256').update(secret).digest('hex');
    }
    await upsertIntegration(app.db, {
      orgId: req.org!.id, provider: PROVIDER, mode: 'access_token', accountLabel: result.accountLabel ?? null,
      secretCiphertext: encryptSecret(token, secretsKey()), secretHint: hint(token), baseUrl: baseUrl ?? null,
      metadata: {
        gitlabEvents: existingMeta.gitlabEvents ?? DEFAULT_EVENTS,
        issuesEnabled: existingMeta.issuesEnabled ?? false,
        webhookSecretCiphertext, webhookTokenHash,
      },
      connectedByUserId: req.user!.sub, lastTestOk: true,
    });
    return reply.code(201).send(toPublicIntegration((await getIntegration(app.db, req.org!.id, PROVIDER))!));
  });

  // Reveal the webhook URL + secret for manual GitLab setup (org admin only).
  app.get('/gitlab/connection/webhook', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!row) return reply.code(404).send({ error: 'not connected' });
    const meta = (row.metadata as IntegrationMetadata) ?? {};
    const secret = meta.webhookSecretCiphertext && app.config.SECRETS_KEY
      ? decryptSecret(meta.webhookSecretCiphertext, secretsKey()) : null;
    return { url: webhookUrl(), secret };
  });

  app.post('/gitlab/connection/test', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!row) return reply.code(404).send({ error: 'not connected' });
    const result = await client.probe(gitlabCredsForRow(row, cfg()));
    let repoCount: number | null = null;
    if (result.ok) { try { repoCount = (await client.listReposDetailed(gitlabCredsForRow(row, cfg()))).repos.length; } catch { /* keep null */ } }
    await setIntegrationTested(app.db, req.org!.id, PROVIDER, result.ok);
    return reply.code(200).send({ ok: result.ok, detail: result.detail, repoCount });
  });

  app.patch('/gitlab/connection/events', guard, async (req, reply) => {
    const parsed = EventsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const ok = await setGitlabIntegrationEvents(app.db, req.org!.id, parsed.data);
    if (!ok) return reply.code(404).send({ error: 'not connected' });
    return reply.code(200).send(toPublicIntegration((await getIntegration(app.db, req.org!.id, PROVIDER))!));
  });

  app.patch('/gitlab/connection/issues', guard, async (req, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const ok = await setIntegrationIssuesEnabled(app.db, req.org!.id, PROVIDER, parsed.data.enabled);
    if (!ok) return reply.code(404).send({ error: 'gitlab not connected' });
    return { ok: true };
  });

  app.delete('/gitlab/connection', guard, async (req, reply) => {
    const ok = await deleteIntegration(app.db, req.org!.id, PROVIDER);
    if (!ok) return reply.code(404).send({ error: 'not connected' });
    return reply.code(204).send();
  });
}
