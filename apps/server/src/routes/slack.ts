import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, decryptSecret, keyFromBase64,
  getIntegration, upsertIntegration, deleteIntegration, toPublicIntegration, createInstallState, consumeInstallState,
  setIntegrationTested,
  listBindings, setBinding, deleteBinding,
} from '@intellilabs/core';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';
import { signState, verifyState, newNonce } from '../integrations/state.js';
import { realSlackClient, type SlackClient } from '@intellilabs/core';

const PROVIDER = 'slack';
const STATE_TTL_SECONDS = 600;
const SCOPES = 'app_mentions:read,chat:write';

export type SlackRouteOpts = { client?: SlackClient };

export async function slackRoutes(app: FastifyInstance, opts: SlackRouteOpts = {}) {
  const client = opts.client ?? realSlackClient;
  const guard = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const hint = (k: string) => `…${k.slice(-4)}`;
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);
  const stateSecret = () => app.config.INTEGRATION_STATE_SECRET ?? app.config.SESSION_SECRET;
  const redirectUri = () => new URL('/api/slack/oauth/callback', app.config.BASE_URL).toString();
  const domain = () => new URL(app.config.BASE_URL).hostname;

  app.post('/slack/install-url', guard, async (req, reply) => {
    if (!app.config.SLACK_CLIENT_ID) return reply.code(503).send({ error: 'slack app not configured' });
    const nonce = newNonce();
    const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
    await createInstallState(app.db, { nonce, orgId: req.org!.id, provider: PROVIDER, userId: req.user!.sub, expiresAt: new Date(exp * 1000) });
    const state = signState({ orgId: req.org!.id, slug: req.org!.slug, provider: PROVIDER, userId: req.user!.sub, nonce, exp }, stateSecret());
    const params = new URLSearchParams({
      client_id: app.config.SLACK_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      state,
    });
    return reply.code(200).send({ url: `https://slack.com/oauth/v2/authorize?${params.toString()}` });
  });

  app.get('/slack/connection', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    return reply.code(200).send(row ? toPublicIntegration(row) : null);
  });

  app.delete('/slack/connection', guard, async (req, reply) => {
    await deleteIntegration(app.db, req.org!.id, PROVIDER);
    return reply.code(204).send();
  });

  const CustomAppSchema = z.object({ botToken: z.string().min(1), signingSecret: z.string().min(1) });

  app.put('/slack/connection/custom-app', guard, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CustomAppSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { botToken, signingSecret } = parsed.data;
    const probe = await client.authTest(botToken);
    if (!probe.ok) return reply.code(400).send({ error: 'token rejected', detail: probe.error });
    await upsertIntegration(app.db, {
      orgId: req.org!.id, provider: PROVIDER, mode: 'custom_app', accountLabel: probe.teamName, baseUrl: null,
      secretCiphertext: encryptSecret(botToken, secretsKey()), secretHint: hint(botToken),
      metadata: {
        teamId: probe.teamId, teamName: probe.teamName, botUserId: probe.botUserId,
        signingSecretCiphertext: encryptSecret(signingSecret, secretsKey()),
      },
      connectedByUserId: req.user!.sub, lastTestOk: true,
    });
    return reply.code(201).send(toPublicIntegration((await getIntegration(app.db, req.org!.id, PROVIDER))!));
  });

  app.post('/slack/connection/test', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!row || !row.secretCiphertext) return reply.code(404).send({ error: 'not connected' });
    const token = decryptSecret(row.secretCiphertext, secretsKey());
    const probe = await client.authTest(token);
    await setIntegrationTested(app.db, req.org!.id, PROVIDER, probe.ok);
    return reply.code(200).send({ ok: probe.ok, detail: probe.ok ? undefined : probe.error });
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/slack/oauth/callback', async (req, reply) => {
    const { code, state, error } = req.query;
    const payload = state ? verifyState(state, stateSecret()) : null;
    if (!payload) return reply.code(400).send({ error: 'invalid state' });
    const adminUrl = (q: string) => `https://${payload.slug}.${domain()}/admin/slack?${q}`;
    if (!app.config.SECRETS_KEY) return reply.redirect(adminUrl('error=server_misconfigured'));
    if (error || !code) return reply.redirect(adminUrl(`error=${encodeURIComponent(error ?? 'no_code')}`));
    const consumed = await consumeInstallState(app.db, payload.nonce);
    if (!consumed || consumed.orgId !== payload.orgId) return reply.code(400).send({ error: 'state expired or already used' });
    const result = await client.oauthAccess({
      code, clientId: app.config.SLACK_CLIENT_ID!, clientSecret: app.config.SLACK_CLIENT_SECRET!, redirectUri: redirectUri(),
    });
    if (!result.ok) return reply.redirect(adminUrl(`error=${encodeURIComponent(result.error)}`));
    await upsertIntegration(app.db, {
      orgId: payload.orgId, provider: PROVIDER, mode: 'oauth', accountLabel: result.teamName, baseUrl: null,
      secretCiphertext: encryptSecret(result.botToken, secretsKey()), secretHint: hint(result.botToken),
      metadata: { teamId: result.teamId, teamName: result.teamName, botUserId: result.botUserId },
      connectedByUserId: payload.userId, lastTestOk: true,
    });
    return reply.redirect(adminUrl('connected=1'));
  });

  const BindSchema = z.object({ channelId: z.string().min(1), projectId: z.string().min(1) });

  app.get('/slack/channels', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(200).send([]);
    return reply.code(200).send(await listBindings(app.db, conn.id));
  });

  app.post('/slack/channels', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(409).send({ error: 'slack not connected' });
    const parsed = BindSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const row = await setBinding(app.db, {
      orgIntegrationId: conn.id, slackChannelId: parsed.data.channelId,
      projectId: parsed.data.projectId, createdByUserId: req.user!.sub,
    });
    return reply.code(201).send(row);
  });

  app.put<{ Params: { channelId: string } }>('/slack/channels/:channelId', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(409).send({ error: 'slack not connected' });
    const parsed = z.object({ projectId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const row = await setBinding(app.db, {
      orgIntegrationId: conn.id, slackChannelId: req.params.channelId,
      projectId: parsed.data.projectId, createdByUserId: req.user!.sub,
    });
    return reply.code(200).send(row);
  });

  app.delete<{ Params: { channelId: string } }>('/slack/channels/:channelId', guard, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!conn) return reply.code(204).send();
    await deleteBinding(app.db, conn.id, req.params.channelId);
    return reply.code(204).send();
  });
}
