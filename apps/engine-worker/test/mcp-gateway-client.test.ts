import { describe, expect, it, vi, type Mock } from 'vitest';
import type { QueuedTurn, Store } from '@intellilabs/core';
import { makeGatewayClient } from '../src/engine/mcp-gateway-client.js';
import { buildEngineDeps } from '../src/engine/bootstrap.js';
import { inMemoryDispatcher, type GatewayClient } from '@intellilabs/engine';

/** A no-DB Store stub: these toolsFor tests never touch Firestore. */
function fakeStore(): Store {
  return {
    db: {} as any,
    vector: { async upsert() {}, async remove() {}, async findNeighbors() { return []; } },
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------
// makeGatewayClient — HTTP client tests
// ---------------------------------------------------------------------------
describe('makeGatewayClient', () => {
  function makeFakeFetch(status: number, body: unknown) {
    return vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as Mock & typeof fetch;
  }

  it('listTools POSTs to /tools/list with correct body and auth header, returns tools array', async () => {
    const fetchImpl = makeFakeFetch(200, { tools: [{ name: 'mcp.github.list_prs', description: 'd', inputSchema: {} }] });
    const getAuthHeader = vi.fn(async () => ({ Authorization: 'Bearer tok123' }));

    const client = makeGatewayClient({
      baseUrl: 'https://gateway.example.com/',
      getAuthHeader,
      fetchImpl,
    });

    const tools = await client.listTools('o1', ['github']);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gateway.example.com/tools/list');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
    expect(JSON.parse(init.body as string)).toEqual({ orgId: 'o1', serverNames: ['github'] });
    expect(tools).toEqual([{ name: 'mcp.github.list_prs', description: 'd', inputSchema: {} }]);
  });

  it('listTools returns empty array when gateway omits tools key', async () => {
    const fetchImpl = makeFakeFetch(200, {});
    const client = makeGatewayClient({
      baseUrl: 'https://gateway.example.com',
      getAuthHeader: async () => ({}),
      fetchImpl,
    });
    const tools = await client.listTools('o1', ['github']);
    expect(tools).toEqual([]);
  });

  it('callTool POSTs to /tools/call with correct body and returns content + isError', async () => {
    const fetchImpl = makeFakeFetch(200, { content: 'result-text', isError: false });
    const getAuthHeader = vi.fn(async () => ({ Authorization: 'Bearer idtok' }));

    const client = makeGatewayClient({
      baseUrl: 'https://gateway.example.com',
      getAuthHeader,
      fetchImpl,
    });

    const result = await client.callTool('o1', 'mcp.x.y', { a: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gateway.example.com/tools/call');
    expect(JSON.parse(init.body as string)).toEqual({ orgId: 'o1', name: 'mcp.x.y', args: { a: 1 } });
    expect(result).toEqual({ content: 'result-text', isError: false });
  });

  it('callTool defaults content to empty string when gateway omits it', async () => {
    const fetchImpl = makeFakeFetch(200, { isError: true });
    const client = makeGatewayClient({
      baseUrl: 'https://gateway.example.com',
      getAuthHeader: async () => ({}),
      fetchImpl,
    });
    const result = await client.callTool('o1', 'mcp.x.y', {});
    expect(result.content).toBe('');
    expect(result.isError).toBe(true);
  });

  it('throws when gateway returns a non-OK status', async () => {
    const fetchImpl = makeFakeFetch(503, {});
    const client = makeGatewayClient({
      baseUrl: 'https://gateway.example.com',
      getAuthHeader: async () => ({}),
      fetchImpl,
    });
    await expect(client.listTools('o1', ['github'])).rejects.toThrow('mcp gateway 503');
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetchImpl = makeFakeFetch(200, { tools: [] });
    const client = makeGatewayClient({
      baseUrl: 'https://gateway.example.com///',
      getAuthHeader: async () => ({}),
      fetchImpl,
    });
    await client.listTools('o1', []);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('https://gateway.example.com/tools/list');
  });
});

// ---------------------------------------------------------------------------
// bootstrap toolsFor — builtins-only vs composite paths
// ---------------------------------------------------------------------------
describe('buildEngineDeps — toolsFor', () => {
  const fakeTurn = {
    orgId: 'org-1',
    payload: { model: 'm', enabledTools: ['builtin.add'] },
  } as unknown as QueuedTurn;

  it('without mcpGatewayClient, toolsFor returns the builtins registry (toToolDefs resolves builtin.add)', async () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
      // no mcpGatewayClient
    });
    const agentLoop = deps.agentLoop!;
    const executor = agentLoop.toolsFor!(fakeTurn);
    const defs = await executor.toToolDefs(['builtin.add']);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]!.name).toBe('builtin.add');
  });

  it('with mcpGatewayClient, toolsFor returns a CompositeToolExecutor that delegates mcp.* to the gateway', async () => {
    const listTools = vi.fn(async (): ReturnType<GatewayClient['listTools']> => [
      { name: 'mcp.gh.list', description: 'd', parameters: {}, kind: 'mcp', mutates: false },
    ]);
    const callTool = vi.fn(async (): ReturnType<GatewayClient['callTool']> => ({ content: 'ok', isError: false }));
    const fakeGateway: GatewayClient = { listTools, callTool };

    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
      mcpGatewayClient: fakeGateway,
    });

    const agentLoop = deps.agentLoop!;
    const executor = agentLoop.toolsFor!(fakeTurn);
    // composite: builtin.add still resolves
    const builtinDefs = await executor.toToolDefs(['builtin.add']);
    expect(builtinDefs[0]!.name).toBe('builtin.add');

    // composite: mcp.* delegates to gateway
    const mcpDefs = await executor.toToolDefs(['mcp.gh.list']);
    expect(listTools).toHaveBeenCalledWith('org-1', ['gh']);
    expect(mcpDefs[0]!.name).toBe('mcp.gh.list');
  });
});
