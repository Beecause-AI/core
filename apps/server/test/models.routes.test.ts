import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, setModelKey, setModelKeyEnabled, encryptSecret, keyFromBase64 } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

const fakeListModels = async (provider: string) =>
  provider === 'anthropic'
    ? { ok: true, ids: ['claude-opus-4-8', 'claude-brand-new'] }
    : { ok: false, ids: [], detail: 'nope' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let cookie: Record<string, string>;
let slug: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api, listModels: fakeListModels });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'P', slug: 'p' });
  slug = proj.slug;
  const ct = encryptSecret('sk-ant-xxxx', keyFromBase64(config.SECRETS_KEY!));
  await setModelKey(t.db, { orgId: org.id, provider: 'anthropic', ciphertext: ct, hint: '…xxxx' });
  await setModelKeyEnabled(t.db, org.id, 'anthropic', true);
  cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'o@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('GET /api/org/projects/:slug/models', () => {
  it('returns platform + enabled-provider groups', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/models`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    const providers = res.json().groups.map((g: any) => g.provider);
    expect(providers).toContain('platform');
    expect(providers).toContain('anthropic');
  });
});

describe('POST /api/org/projects/:slug/models/refresh', () => {
  it('merges live ids into the anthropic group', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/org/projects/${slug}/models/refresh`, cookies: cookie, headers: HOST, payload: { provider: 'anthropic' } });
    expect(res.statusCode).toBe(200);
    const anthropic = res.json().groups.find((g: any) => g.provider === 'anthropic');
    expect(anthropic.models.find((m: any) => m.id === 'claude-brand-new')?.origin).toBe('live');
  });

  it('reports a clean error when the provider key is missing/disabled', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/org/projects/${slug}/models/refresh`, cookies: cookie, headers: HOST, payload: { provider: 'openai' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not configured|no .*key/i);
  });
});
