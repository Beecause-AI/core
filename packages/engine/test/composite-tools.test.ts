import { describe, expect, it, vi } from 'vitest';
import { CompositeToolExecutor, McpToolExecutor, type GatewayClient } from '../src/tools/mcp.js';
import { RecentSearchToolExecutor } from '../src/tools/recent.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { addTool } from '../src/tools/builtins/add.js';
import type { ToolDef } from '../src/provider.js';

const mcpDef = (name: string, mutates = true): ToolDef => ({ name, description: 'd', parameters: { type: 'object' }, kind: 'mcp', mutates });

function fakeGw(defs: ToolDef[]): { gw: GatewayClient; calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    gw: {
      listTools: vi.fn(async (_orgId: string, _serverNames: string[]) => defs),
      callTool: vi.fn(async (_orgId: string, name: string, args: unknown) => { calls.push({ name, args }); return { content: `ran ${name}` }; }),
    },
  };
}

describe('McpToolExecutor', () => {
  it('lists only the requested mcp.* tools (filtered) from the gateway by server name', async () => {
    const { gw } = fakeGw([mcpDef('mcp.github.read'), mcpDef('mcp.github.write'), mcpDef('mcp.other.x')]);
    const ex = new McpToolExecutor(gw, 'org1');
    const defs = await ex.toToolDefs(['mcp.github.write', 'builtin.add']);
    expect(defs.map((d) => d.name)).toEqual(['mcp.github.write']); // only the requested mcp tool
    expect(gw.listTools).toHaveBeenCalledWith('org1', ['github']); // server names derived
  });
  it('execute routes to the gateway callTool with orgId', async () => {
    const { gw, calls } = fakeGw([]);
    const ex = new McpToolExecutor(gw, 'org1');
    const r = await ex.execute({ id: 'c1', name: 'mcp.github.write', arguments: { a: 1 } }, new AbortController().signal);
    expect(calls[0]).toEqual({ name: 'mcp.github.write', args: { a: 1 } });
    expect(r).toMatchObject({ toolCallId: 'c1', name: 'mcp.github.write', content: 'ran mcp.github.write' });
  });
  it('execute returns isError when the gateway throws', async () => {
    const gw: GatewayClient = { listTools: async () => [], callTool: async () => { throw new Error('gw down'); } };
    const ex = new McpToolExecutor(gw, 'org1');
    const r = await ex.execute({ id: 'c', name: 'mcp.x.y', arguments: {} }, new AbortController().signal);
    expect(r.isError).toBe(true);
  });
});

describe('CompositeToolExecutor', () => {
  const reg = new ToolRegistry([addTool]);
  it('merges builtin + mcp defs by prefix', async () => {
    const { gw } = fakeGw([mcpDef('mcp.github.write')]);
    const comp = new CompositeToolExecutor(reg, new McpToolExecutor(gw, 'org1'));
    const defs = await comp.toToolDefs(['builtin.add', 'mcp.github.write']);
    expect(defs.map((d) => d.name).sort()).toEqual(['builtin.add', 'mcp.github.write']);
  });
  it('routes execute by prefix', async () => {
    const { gw, calls } = fakeGw([]);
    const comp = new CompositeToolExecutor(reg, new McpToolExecutor(gw, 'org1'));
    const add = await comp.execute({ id: 'a', name: 'builtin.add', arguments: { a: 2, b: 3 } }, new AbortController().signal);
    expect(add.content).toBe('5');
    await comp.execute({ id: 'm', name: 'mcp.github.write', arguments: {} }, new AbortController().signal);
    expect(calls[0].name).toBe('mcp.github.write');
  });
  it('unknown prefix → isError', async () => {
    const comp = new CompositeToolExecutor(reg, new McpToolExecutor(fakeGw([]).gw, 'org1'));
    const r = await comp.execute({ id: 'x', name: 'weird.tool', arguments: {} }, new AbortController().signal);
    expect(r.isError).toBe(true);
  });

  it('routes recent.search to the recent executor when provided', async () => {
    const recentClient = { search: vi.fn(async () => '- [resolved] past incident') };
    const recentEx = new RecentSearchToolExecutor(recentClient, 'org1', 'proj1', 'excl-conv');
    const comp = new CompositeToolExecutor(reg, new McpToolExecutor(fakeGw([]).gw, 'org1'), undefined, undefined, undefined, recentEx);
    const defs = await comp.toToolDefs(['recent.search', 'builtin.add']);
    expect(defs.map((d) => d.name)).toContain('recent.search');
    const r = await comp.execute({ id: 'r1', name: 'recent.search', arguments: { query: 'db issue' } }, new AbortController().signal);
    expect(r.isError).toBe(false);
    expect(r.content).toBe('- [resolved] past incident');
  });

  it('recent.search → "no recent source" error when recent arm is absent', async () => {
    const comp = new CompositeToolExecutor(reg, new McpToolExecutor(fakeGw([]).gw, 'org1'));
    const r = await comp.execute({ id: 'r2', name: 'recent.search', arguments: { query: 'something' } }, new AbortController().signal);
    expect(r.isError).toBe(true);
    expect(r.content).toBe('no recent source');
  });

  it('recent.search not in defs when recent arm is absent', async () => {
    const comp = new CompositeToolExecutor(reg, new McpToolExecutor(fakeGw([]).gw, 'org1'));
    const defs = await comp.toToolDefs(['recent.search']);
    expect(defs.map((d) => d.name)).not.toContain('recent.search');
  });
});
