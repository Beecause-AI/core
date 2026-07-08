import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptSecret, keyFromBase64, listModelKeys, getKeyCiphertext, getIntegration, listProjectRepos, getCurrentBuildId } from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireUser, requireProjectMember } from '../auth/guard.js';
import { listProviderModels, type ListModelsResult } from '../providers/list-models.js';
import { buildModelGroups } from './models-groups.js';
import type { McpListTools } from '../integrations/mcp/gateway.js';
import { githubToolDefs } from '../integrations/github/tools.js';
import { knowledgeGraphToolDefs } from '../integrations/knowledge-graph/tools.js';
import { gcpToolDefs, filterGcpToolDefs } from '../integrations/gcp/tools.js';
import { projectGcpContext } from '../integrations/gcp/signals.js';
import { cloudflareToolDefs, filterCloudflareToolDefs } from '../integrations/cloudflare/tools.js';
import { projectHasCloudflare } from '../integrations/cloudflare/signals.js';

export interface ModelsRouteOpts {
  listModels?: (provider: string, key: string, opts?: { baseUrl?: string }) => Promise<ListModelsResult>;
  mcpListTools?: McpListTools;
}

const RefreshBody = z.object({ provider: z.enum(['anthropic', 'openai', 'google', 'openai-compatible']) });

const TTL_MS = 5 * 60_000;
const liveCache = new Map<string, Map<string, { ids: string[]; at: number }>>();
function cachedLive(orgId: string): Record<string, string[]> {
  const m = liveCache.get(orgId);
  if (!m) return {};
  const out: Record<string, string[]> = {};
  for (const [p, v] of m) if (Date.now() - v.at < TTL_MS) out[p] = v.ids;
  return out;
}
function putLive(orgId: string, provider: string, ids: string[]): void {
  const m = liveCache.get(orgId) ?? new Map();
  m.set(provider, { ids, at: Date.now() });
  liveCache.set(orgId, m);
}

export async function modelsRoutes(app: FastifyInstance, opts: ModelsRouteOpts = {}) {
  const listModels = opts.listModels ?? ((p, k, o) => listProviderModels(p, k, o));
  const guard = { preHandler: [resolveOrg, requireUser, requireProjectMember] };

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/models', guard, async (req) => {
    const keys = await listModelKeys(app.db, req.org!.id);
    return { groups: buildModelGroups({ keys, live: cachedLive(req.org!.id) }) };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/models/refresh', guard, async (req, reply) => {
    const parsed = RefreshBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    if (!app.config.SECRETS_KEY) return reply.code(503).send({ error: 'key storage not configured' });
    const { provider } = parsed.data;
    const stored = await getKeyCiphertext(app.db, req.org!.id, provider);
    if (!stored) return reply.code(400).send({ error: `no ${provider} key configured` });
    const key = decryptSecret(stored.ciphertext, keyFromBase64(app.config.SECRETS_KEY));
    const result = await listModels(provider, key, stored.baseUrl ? { baseUrl: stored.baseUrl } : undefined);
    if (!result.ok) return reply.code(502).send({ error: 'refresh failed', detail: result.detail });
    putLive(req.org!.id, provider, result.ids);
    const keys = await listModelKeys(app.db, req.org!.id);
    return reply.code(200).send({ groups: buildModelGroups({ keys, live: cachedLive(req.org!.id) }) });
  });

  const mcpListTools = opts.mcpListTools ?? (async () => []);
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/mcp-tools', guard, async (req) => {
    const tools = await mcpListTools(req.org!.id);
    return { tools };
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/integration-tools', guard, async (req) => {
    const defs: { name: string; mutates: boolean; description: string }[] = [];
    const map = (d: { name: string; mutates: boolean; description: string }) => ({ name: d.name, mutates: d.mutates, description: d.description });
    const gh = await getIntegration(app.db, req.org!.id, 'github');
    if (gh && gh.enabled) defs.push(...githubToolDefs().map(map));
    // Slack comms are handled exclusively by the Slack system agent, not assignable
    // per-assistant — so slack tools are intentionally excluded from the picker catalog.
    // (The runtime/system-agent path keeps them via slackToolDefs() in /int/tools/list.)
    const repos = await listProjectRepos(app.db, req.project!.id);
    let hasGraph = false;
    for (const r of repos) {
      if (await getCurrentBuildId(app.db, req.org!.id, r.repoFullName)) { hasGraph = true; break; }
    }
    if (hasGraph) defs.push(...knowledgeGraphToolDefs().map(map));
    const gcpCtx = await projectGcpContext(app.db, req.org!.id, req.project!.id);
    defs.push(...filterGcpToolDefs(gcpToolDefs(), gcpCtx).map(map));
    const cfHas = await projectHasCloudflare(app.db, req.project!.id);
    if (cfHas) defs.push(...filterCloudflareToolDefs(cloudflareToolDefs(), true).map(map));
    return { tools: defs };
  });
}
