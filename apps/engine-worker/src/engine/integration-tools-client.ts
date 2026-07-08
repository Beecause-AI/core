import type { IntegrationToolsClient } from '@intellilabs/engine';
import { injectTraceHeaders } from '@intellilabs/core';

type FetchImpl = typeof fetch;

/** IntegrationToolsClient backed by HTTP to apps/server's /int tool API. */
export function makeIntegrationToolsClient(opts: {
  baseUrl: string;
  getAuthHeader: () => Promise<Record<string, string>>;
  fetchImpl?: FetchImpl;
}): IntegrationToolsClient {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  async function post(path: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(await opts.getAuthHeader()) };
    injectTraceHeaders(headers);
    const res = await f(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`int tool api ${res.status}`);
    return res.json();
  }
  return {
    async listTools(orgId, projectId, context) {
      const r = await post('/int/tools/list', { orgId, projectId, context });
      return r.tools ?? [];
    },
    async callTool(orgId, projectId, name, args, context) {
      const r = await post('/int/tools/call', { orgId, projectId, name, args, context });
      return { content: r.content ?? '', isError: r.isError };
    },
  };
}
