import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServer } from '@intellilabs/core';
import type { McpConn, RawTool } from './gateway.js';

export const realClientFactory = async (server: McpServer, token: string | null): Promise<McpConn> => {
  const transportOpts = token
    ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(server.url), transportOpts);
  const client = new Client({ name: 'intellilabs-mcp-gateway', version: '1.0.0' });
  await client.connect(transport);

  return {
    async listTools(): Promise<RawTool[]> {
      const r = await client.listTools();
      // r.tools is the typed array from the SDK; cast to RawTool[] since RawTool is a superset
      return r.tools as unknown as RawTool[];
    },

    async callTool(name: string, args: unknown): Promise<{ content: string; isError?: boolean }> {
      const r = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      // r.content is an array of content items; extract all text items
      const items = Array.isArray((r as { content?: unknown }).content)
        ? (r as { content: Array<{ type?: string; text?: string }> }).content
        : [];
      const content = items
        .filter((c) => c?.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
      return { content, isError: !!(r as { isError?: boolean }).isError };
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
};
