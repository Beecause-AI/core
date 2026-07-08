import { describe, expect, it, vi } from 'vitest';
import { McpGateway } from '../src/gateway.js';
import type { McpServer } from '@intellilabs/core';

const server = (over: Partial<McpServer> = {}): McpServer => ({
  id: 's1', orgId: 'o1', name: 'github', url: 'https://x', authType: 'none', secretCiphertext: null, enabled: true, createdAt: new Date(), ...over,
} as McpServer);

function fakeFactory(tools: any[], onCall?: (n: string, a: unknown) => any) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const listSpy = vi.fn(async () => tools);
  const factory = vi.fn(async (_s: McpServer, _t: string | null) => ({
    listTools: listSpy,
    callTool: async (name: string, args: unknown) => { calls.push({ name, args }); return onCall ? onCall(name, args) : { content: 'ok' }; },
    close: async () => {},
  }));
  return { factory, listSpy, calls };
}

describe('McpGateway', () => {
  it('lists tools namespaced + derives mutates from readOnlyHint', async () => {
    const { factory } = fakeFactory([
      { name: 'read_file', description: 'r', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'write_file', description: 'w', inputSchema: { type: 'object' } }, // no annotation → mutates
    ]);
    const gw = new McpGateway({ loadServers: async () => [server()], clientFactory: factory });
    const defs = await gw.listTools('o1');
    expect(defs).toContainEqual({ name: 'mcp.github.read_file', description: 'r', parameters: { type: 'object' }, kind: 'mcp', mutates: false });
    expect(defs.find((d) => d.name === 'mcp.github.write_file')?.mutates).toBe(true);
  });

  it('caches schema within TTL (factory/listTools called once)', async () => {
    const { factory, listSpy } = fakeFactory([{ name: 't', inputSchema: {}, annotations: { readOnlyHint: true } }]);
    const gw = new McpGateway({ loadServers: async () => [server()], clientFactory: factory, ttlMs: 10_000 });
    await gw.listTools('o1'); await gw.listTools('o1');
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('callTool strips the mcp.<server>. prefix to the bare tool name', async () => {
    const { factory, calls } = fakeFactory([], (n) => ({ content: `did ${n}` }));
    const gw = new McpGateway({ loadServers: async () => [server()], clientFactory: factory });
    const r = await gw.callTool('o1', 'mcp.github.write_file', { a: 1 });
    expect(calls[0]).toEqual({ name: 'write_file', args: { a: 1 } });
    expect(r.content).toBe('did write_file');
  });

  it('listTools skips a server whose connection throws (no total failure)', async () => {
    const bad = vi.fn(async () => { throw new Error('boom'); });
    const gw = new McpGateway({ loadServers: async () => [server({ id: 'bad', name: 'bad' })], clientFactory: bad });
    const defs = await gw.listTools('o1');
    expect(defs).toEqual([]); // skipped, not thrown
  });

  it('callTool returns isError for an unknown server prefix', async () => {
    const { factory } = fakeFactory([]);
    const gw = new McpGateway({ loadServers: async () => [server()], clientFactory: factory });
    const r = await gw.callTool('o1', 'mcp.nope.x', {});
    expect(r.isError).toBe(true);
  });
});
