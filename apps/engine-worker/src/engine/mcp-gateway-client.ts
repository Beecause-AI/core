import type { GatewayClient } from '@intellilabs/engine';
import { injectTraceHeaders } from '@intellilabs/core';

type FetchImpl = typeof fetch;

/** GatewayClient backed by HTTP to the MCP gateway. Auth header + fetch are injected
 *  so it's unit-testable; the worker supplies a Google ID-token header in prod. */
export function makeGatewayClient(opts: {
  baseUrl: string;
  getAuthHeader: () => Promise<Record<string, string>>;
  fetchImpl?: FetchImpl;
}): GatewayClient {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  async function post(path: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(await opts.getAuthHeader()) };
    injectTraceHeaders(headers);
    const res = await f(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`mcp gateway ${res.status}`);
    return res.json();
  }
  return {
    async listTools(orgId, serverNames) {
      const r = await post('/tools/list', { orgId, serverNames });
      return r.tools ?? [];
    },
    async callTool(orgId, name, args) {
      const r = await post('/tools/call', { orgId, name, args });
      return { content: r.content ?? '', isError: r.isError };
    },
  };
}
