import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { McpGateway } from '../src/gateway.js';
import type { McpServer } from '@intellilabs/core';

const mkServer = (over: Partial<McpServer> = {}): McpServer => ({
  id: 's1', orgId: 'o1', name: 'github', url: 'https://x', authType: 'none',
  secretCiphertext: null, enabled: true, createdAt: new Date(), ...over,
} as McpServer);

function buildTestApp(tools: any[], onCall?: (n: string, a: unknown) => any) {
  const factory = vi.fn(async (_s: McpServer, _t: string | null) => ({
    listTools: vi.fn(async () => tools),
    callTool: async (name: string, args: unknown) => onCall ? onCall(name, args) : { content: 'ok' },
    close: async () => {},
  }));
  const gateway = new McpGateway({
    loadServers: async () => [mkServer()],
    clientFactory: factory,
  });
  return buildApp({ gateway });
}

describe('POST /tools/list', () => {
  it('returns tools for a valid orgId', async () => {
    const app = await buildTestApp([
      { name: 'read_file', description: 'read', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/list',
      payload: { orgId: 'o1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({
      name: 'mcp.github.read_file',
      kind: 'mcp',
      mutates: false,
    });
  });

  it('returns 400 when orgId is missing', async () => {
    const app = await buildTestApp([]);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/list',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation failed' });
  });

  it('filters by serverNames when provided', async () => {
    const app = await buildTestApp([{ name: 'read_file', inputSchema: {} }]);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/list',
      payload: { orgId: 'o1', serverNames: ['other'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toHaveLength(0); // 'other' server not in loadServers result
  });
});

describe('POST /tools/call', () => {
  it('calls a tool and returns its result', async () => {
    const app = await buildTestApp([], (n) => ({ content: `called ${n}` }));
    const res = await app.inject({
      method: 'POST',
      url: '/tools/call',
      payload: { orgId: 'o1', name: 'mcp.github.read_file', args: { path: '/tmp/x' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ content: 'called read_file' });
  });

  it('returns isError for unknown server prefix', async () => {
    const app = await buildTestApp([]);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/call',
      payload: { orgId: 'o1', name: 'mcp.nope.x', args: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isError: true });
  });

  it('returns 400 when name is missing', async () => {
    const app = await buildTestApp([]);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/call',
      payload: { orgId: 'o1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation failed' });
  });
});
