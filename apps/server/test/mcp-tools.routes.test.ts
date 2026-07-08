import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const config: AppConfig = { ...testConfig };

const fakeMcpList = async (_orgId: string) => [
  { name: 'mcp.github.search', kind: 'mcp', mutates: false, description: 'Search' },
  { name: 'mcp.github.create_issue', kind: 'mcp', mutates: true, description: 'Create issue' },
];

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let cookie: Record<string, string>;
let slug: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api, mcpListTools: fakeMcpList });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  const proj = await createProject(t.db, org.id, { name: 'P', slug: 'p' });
  slug = proj.slug;
  cookie = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'o@x.dev' }, config.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('GET /api/org/projects/:slug/mcp-tools', () => {
  it('returns the org MCP tools from the gateway', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${slug}/mcp-tools`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools.map((t: any) => t.name)).toContain('mcp.github.search');
  });

  it('returns an empty list when no gateway is configured (default)', async () => {
    // A second app with no mcpListTools seam and no MCP_GATEWAY_URL → stub returns [].
    const app2 = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api });
    const res = await app2.inject({ method: 'GET', url: `/api/org/projects/${slug}/mcp-tools`, cookies: cookie, headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toEqual([]);
    await app2.close();
  });
});
