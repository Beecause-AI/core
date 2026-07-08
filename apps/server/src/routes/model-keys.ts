import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptSecret, decryptSecret, keyFromBase64, setModelKey, setModelKeyEnabled, setModelKeyTested, listModelKeys, deleteModelKey, getKeyCiphertext } from '@intellilabs/core';
import { requireSessionUser } from '../auth/session-guard.js';
import { requireOrgAdmin } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';
import { probeProvider, assertSafeBaseUrl, type ProbeResult } from '../providers/probe.js';

const BYOK_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'openai-compatible']);
const SetSchema = z.object({ key: z.string().trim().min(8).max(400), baseUrl: z.string().trim().max(400).optional() });
const ToggleSchema = z.object({ enabled: z.boolean() });

export interface ModelKeyRouteOpts {
  /** Injectable for tests; defaults to the real network probe. */
  probe?: (provider: string, key: string, opts?: { baseUrl?: string }) => Promise<ProbeResult>;
}

export async function modelKeyRoutes(app: FastifyInstance, opts: ModelKeyRouteOpts = {}) {
  const probe = opts.probe ?? ((p, k, o) => probeProvider(p, k, o));
  const guard = { preHandler: [resolveOrg, requireSessionUser, requireOrgAdmin] };
  const hint = (k: string) => `…${k.slice(-4)}`;

  app.get('/model-keys', guard, async (req) => listModelKeys(app.db, req.org!.id));

  app.put<{ Params: { provider: string } }>('/model-keys/:provider', guard, async (req, reply) => {
    const { provider } = req.params;
    if (!BYOK_PROVIDERS.has(provider)) return reply.code(400).send({ error: 'unsupported provider' });
    const parsed = SetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const { key, baseUrl } = parsed.data;
    if (provider === 'openai-compatible') {
      if (!baseUrl) return reply.code(400).send({ error: 'baseUrl required for openai-compatible' });
      try { assertSafeBaseUrl(baseUrl); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    }
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'key storage not configured' });
    const result = await probe(provider, key, baseUrl ? { baseUrl } : undefined);
    if (!result.ok) return reply.code(400).send({ error: 'key rejected', detail: result.detail });
    const ciphertext = encryptSecret(key, keyFromBase64(app.config.SECRETS_KEY));
    await setModelKey(app.db, { orgId: req.org!.id, provider, ciphertext, hint: hint(key), baseUrl: baseUrl ?? null, lastTestOk: true });
    const row = (await listModelKeys(app.db, req.org!.id)).find((r) => r.provider === provider)!;
    return reply.code(201).send(row);
  });

  app.post<{ Params: { provider: string } }>('/model-keys/:provider/test', guard, async (req, reply) => {
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'key storage not configured' });
    const stored = await getKeyCiphertext(app.db, req.org!.id, req.params.provider);
    if (!stored) return reply.code(404).send({ error: 'not found' });
    const key = decryptSecret(stored.ciphertext, keyFromBase64(app.config.SECRETS_KEY));
    const result = await probe(req.params.provider, key, stored.baseUrl ? { baseUrl: stored.baseUrl } : undefined);
    await setModelKeyTested(app.db, req.org!.id, req.params.provider, result.ok);
    return reply.code(200).send({ ok: result.ok, detail: result.detail });
  });

  app.patch<{ Params: { provider: string } }>('/model-keys/:provider', guard, async (req, reply) => {
    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const ok = await setModelKeyEnabled(app.db, req.org!.id, req.params.provider, parsed.data.enabled);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(200).send({ provider: req.params.provider, enabled: parsed.data.enabled });
  });

  app.delete<{ Params: { provider: string } }>('/model-keys/:provider', guard, async (req, reply) => {
    const ok = await deleteModelKey(app.db, req.org!.id, req.params.provider);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
