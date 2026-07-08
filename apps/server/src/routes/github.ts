import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  encryptSecret, decryptSecret, keyFromBase64,
  upsertIntegration, getIntegration, setIntegrationTested,
  setIntegrationEvents, setIntegrationIssuesEnabled, deleteIntegration, createInstallState, consumeInstallState, toPublicIntegration,
  credsForRow,
  type IntegrationMetadata,
} from '@intellilabs/core';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';
import { assertSafeBaseUrl } from '../security/ssrf.js';
import { signState, verifyState, newNonce } from '../integrations/state.js';
import { realGithubClient, type GithubClient, type AppCreds, type PatCreds } from '../integrations/github/client.js';

const PROVIDER = 'github';
const DEFAULT_EVENTS = { issues: true, pullRequests: true, branches: true };
const STATE_TTL_SECONDS = 600;

const PatSchema = z.object({ token: z.string().trim().min(8).max(400), baseUrl: z.string().trim().max(400).optional() });
const CustomAppSchema = z.object({
  appId: z.string().trim().min(1).max(40),
  privateKey: z.string().trim().min(40).max(8000),
  installationId: z.string().trim().min(1).max(40),
  webhookSecret: z.string().trim().min(8).max(400).optional(),
  baseUrl: z.string().trim().max(400).optional(),
});
const EventsSchema = z.object({ issues: z.boolean().optional(), pullRequests: z.boolean().optional(), branches: z.boolean().optional() });

export interface GithubRouteOpts { client?: GithubClient; }

export async function githubRoutes(app: FastifyInstance, opts: GithubRouteOpts = {}) {
  const client = opts.client ?? realGithubClient;
  const guard = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const hint = (k: string) => `…${k.slice(-4)}`;
  const stateSecret = () => app.config.INTEGRATION_STATE_SECRET ?? app.config.SESSION_SECRET;
  const slug = () => app.config.GITHUB_APP_SLUG ?? 'intellilabs-agent';
  const domain = () => new URL(app.config.BASE_URL).hostname;
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  const appConfig = () => ({ SECRETS_KEY: app.config.SECRETS_KEY, GITHUB_APP_ID: app.config.GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY: app.config.GITHUB_APP_PRIVATE_KEY });

  app.get('/github/connection', guard, async (req) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    return row ? toPublicIntegration(row) : null;
  });

  app.get('/github/connection/repos', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!row) return reply.code(404).send({ error: 'not connected' });
    if (row.mode === 'pat') {
      const repos = await client.listRepos({ mode: 'pat', token: decryptSecret(row.secretCiphertext!, secretsKey()), baseUrl: row.baseUrl ?? undefined });
      return { repos };
    }
    const c = credsForRow(row, appConfig());
    const repos = await client.listRepos(c);
    return { repos };
  });

  app.post('/github/install-url', guard, async (req, reply) => {
    if (!app.config.GITHUB_APP_ID || !app.config.GITHUB_APP_PRIVATE_KEY) return reply.code(503).send({ error: 'github app not configured' });
    const nonce = newNonce();
    const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
    await createInstallState(app.db, { nonce, orgId: req.org!.id, provider: PROVIDER, userId: req.user!.sub, expiresAt: new Date(exp * 1000) });
    const state = signState({ orgId: req.org!.id, slug: req.org!.slug, provider: PROVIDER, userId: req.user!.sub, nonce, exp }, stateSecret());
    const url = `https://github.com/apps/${slug()}/installations/new?state=${encodeURIComponent(state)}`;
    return reply.code(200).send({ url });
  });

  app.get<{ Querystring: { installation_id?: string; state?: string } }>('/github/setup', async (req, reply) => {
    const { installation_id, state } = req.query;
    const payload = state ? verifyState(state, stateSecret()) : null;
    if (!payload || !installation_id) return reply.code(400).send({ error: 'invalid state' });
    const consumed = await consumeInstallState(app.db, payload.nonce);
    if (!consumed || consumed.orgId !== payload.orgId) return reply.code(400).send({ error: 'state expired or already used' });

    const creds: AppCreds = { appId: app.config.GITHUB_APP_ID!, privateKey: app.config.GITHUB_APP_PRIVATE_KEY!, installationId: installation_id };
    const account = await client.installationAccount(creds);
    await upsertIntegration(app.db, {
      orgId: payload.orgId, provider: PROVIDER, mode: 'agent_app', accountLabel: account ?? null,
      secretCiphertext: null, secretHint: null, baseUrl: null,
      metadata: { installationId: installation_id, events: DEFAULT_EVENTS },
      connectedByUserId: payload.userId, lastTestOk: true,
    });
    return reply.redirect(`https://${payload.slug}.${domain()}/admin/github?connected=1`);
  });

  app.put('/github/connection/pat', guard, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = PatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { token, baseUrl } = parsed.data;
    if (baseUrl) { try { assertSafeBaseUrl(baseUrl); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); } }
    const result = await client.probePat({ token, baseUrl });
    if (!result.ok) return reply.code(400).send({ error: 'token rejected', detail: result.detail });
    await upsertIntegration(app.db, {
      orgId: req.org!.id, provider: PROVIDER, mode: 'pat', accountLabel: result.accountLabel ?? null,
      secretCiphertext: encryptSecret(token, secretsKey()), secretHint: hint(token), baseUrl: baseUrl ?? null,
      metadata: { events: DEFAULT_EVENTS }, connectedByUserId: req.user!.sub, lastTestOk: true,
    });
    return reply.code(201).send(toPublicIntegration((await getIntegration(app.db, req.org!.id, PROVIDER))!));
  });

  app.put('/github/connection/custom-app', guard, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'secret storage not configured' });
    const parsed = CustomAppSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { appId, privateKey, installationId, webhookSecret, baseUrl } = parsed.data;
    if (baseUrl) { try { assertSafeBaseUrl(baseUrl); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); } }
    const result = await client.probeApp({ appId, privateKey, installationId, baseUrl });
    if (!result.ok) return reply.code(400).send({ error: 'app credentials rejected', detail: result.detail });
    const metadata: IntegrationMetadata = {
      appId, installationId, events: DEFAULT_EVENTS,
      ...(webhookSecret ? { webhookSecretCiphertext: encryptSecret(webhookSecret, secretsKey()) } : {}),
    };
    await upsertIntegration(app.db, {
      orgId: req.org!.id, provider: PROVIDER, mode: 'custom_app', accountLabel: result.accountLabel ?? null,
      secretCiphertext: encryptSecret(privateKey, secretsKey()), secretHint: null, baseUrl: baseUrl ?? null,
      metadata, connectedByUserId: req.user!.sub, lastTestOk: true,
    });
    return reply.code(201).send(toPublicIntegration((await getIntegration(app.db, req.org!.id, PROVIDER))!));
  });

  app.post('/github/connection/test', guard, async (req, reply) => {
    const row = await getIntegration(app.db, req.org!.id, PROVIDER);
    if (!row) return reply.code(404).send({ error: 'not connected' });
    const creds = credsForRow(row, appConfig());
    const result = row.mode === 'pat'
      ? await client.probePat(creds as PatCreds)
      : await client.probeApp(creds as AppCreds);
    let repoCount: number | null = null;
    if (result.ok) {
      try {
        repoCount = (await client.listRepos(creds)).length;
      } catch {
        // listRepos failed despite a good auth probe — report auth result with repoCount=null
      }
    }
    await setIntegrationTested(app.db, req.org!.id, PROVIDER, result.ok);
    return reply.code(200).send({ ok: result.ok, detail: result.detail, repoCount });
  });

  app.patch('/github/connection/events', guard, async (req, reply) => {
    const parsed = EventsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const ok = await setIntegrationEvents(app.db, req.org!.id, PROVIDER, parsed.data);
    if (!ok) return reply.code(404).send({ error: 'not connected' });
    return reply.code(200).send(toPublicIntegration((await getIntegration(app.db, req.org!.id, PROVIDER))!));
  });

  app.patch('/github/connection/issues', guard, async (req, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const ok = await setIntegrationIssuesEnabled(app.db, req.org!.id, PROVIDER, parsed.data.enabled);
    if (!ok) return reply.code(404).send({ error: 'github not connected' });
    return { ok: true };
  });

  app.delete('/github/connection', guard, async (req, reply) => {
    const ok = await deleteIntegration(app.db, req.org!.id, PROVIDER);
    if (!ok) return reply.code(404).send({ error: 'not connected' });
    return reply.code(204).send();
  });
}
