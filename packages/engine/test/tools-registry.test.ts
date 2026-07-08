import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { addTool } from '../src/tools/builtins/add.js';

describe('ToolRegistry', () => {
  const reg = new ToolRegistry([addTool]);

  it('exposes ToolDefs for the requested names only', () => {
    const defs = reg.toToolDefs(['builtin.add', 'builtin.unknown']);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'builtin.add', kind: 'builtin', mutates: false });
    expect(defs[0]!.parameters).toMatchObject({ type: 'object' });
  });

  it('executes a known tool and returns a ToolResult', async () => {
    const res = await reg.execute(
      { id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } },
      new AbortController().signal,
    );
    expect(res).toEqual({ toolCallId: 'c1', name: 'builtin.add', content: '5' });
  });

  it('returns an isError result for an unknown tool', async () => {
    const res = await reg.execute(
      { id: 'c2', name: 'builtin.nope', arguments: {} },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.toolCallId).toBe('c2');
  });

  it('returns an isError result when arguments are invalid', async () => {
    const res = await reg.execute(
      { id: 'c3', name: 'builtin.add', arguments: { a: 'x', b: 3 } },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
  });
});
