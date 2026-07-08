import { describe, it, expect } from 'vitest';
import { CompositeToolExecutor } from '../src/tools/mcp.js';
import type { ToolExecutor } from '../src/tools/types.js';

const src = (prefix: string): ToolExecutor => ({
  toToolDefs: (names) => names.filter((n) => n.startsWith(prefix)).map((n) => ({ name: n, description: '', parameters: {}, kind: 'integration' as const, mutates: false })),
  execute: async (c) => ({ toolCallId: c.id, name: c.name, content: `${prefix}:${c.name}` }),
});

describe('CompositeToolExecutor integrations branch', () => {
  it('routes integration.* to the integrations source', async () => {
    const comp = new CompositeToolExecutor(src('builtin.'), src('mcp.'), src('agent.'), src('integration.'));
    const defs = await comp.toToolDefs(['integration.github.get_file']);
    expect(defs.map((d) => d.name)).toEqual(['integration.github.get_file']);
    const r = await comp.execute({ id: '1', name: 'integration.github.get_file', arguments: {} }, new AbortController().signal);
    expect(r.content).toBe('integration.:integration.github.get_file');
  });
});

describe('CompositeToolExecutor builtins branch', () => {
  it('routes team.* (e.g. team.submit_proposal) to the builtins source — not "unknown tool"', async () => {
    // team.submit_proposal lives in the builtins ToolRegistry but does not use the builtin.* prefix;
    // the composite must still route it to builtins or it falls through to "unknown tool".
    const builtins: ToolExecutor = {
      toToolDefs: (names) =>
        names
          .filter((n) => n.startsWith('builtin.') || n.startsWith('team.'))
          .map((n) => ({ name: n, description: '', parameters: {}, kind: 'builtin' as const, mutates: false })),
      execute: async (c) => ({ toolCallId: c.id, name: c.name, content: `builtins:${c.name}` }),
    };
    const comp = new CompositeToolExecutor(builtins, src('mcp.'), src('agent.'), src('integration.'));

    const defs = await comp.toToolDefs(['team.submit_proposal']);
    expect(defs.map((d) => d.name)).toEqual(['team.submit_proposal']);

    const r = await comp.execute({ id: '1', name: 'team.submit_proposal', arguments: {} }, new AbortController().signal);
    expect(r.content).toBe('builtins:team.submit_proposal');
    expect(r.isError).toBeFalsy();
  });
});
