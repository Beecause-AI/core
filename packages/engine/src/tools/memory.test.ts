import { describe, it, expect } from 'vitest';
import { MemoryToolExecutor, type MemoryClient } from './memory.js';

const client: MemoryClient = { recall: async (_o, _p, _a, q) => `recalled for: ${q}` };
const sig = new AbortController().signal;

describe('MemoryToolExecutor', () => {
  it('exposes memory.recall only when requested AND scoped', async () => {
    const ex = new MemoryToolExecutor(client, 'o', 'p', 'a');
    expect((await ex.toToolDefs(['memory.recall'])).map((d) => d.name)).toEqual(['memory.recall']);
    expect(await ex.toToolDefs(['builtin.add'])).toEqual([]);
    const unscoped = new MemoryToolExecutor(client, 'o', undefined, undefined);
    expect(await unscoped.toToolDefs(['memory.recall'])).toEqual([]);
  });
  it('executes recall', async () => {
    const ex = new MemoryToolExecutor(client, 'o', 'p', 'a');
    const r = await ex.execute({ id: '1', name: 'memory.recall', arguments: { query: 'db errors' } }, sig);
    expect(r.content).toContain('db errors');
    expect(r.isError).toBeFalsy();
  });
  it('errors when query missing', async () => {
    const ex = new MemoryToolExecutor(client, 'o', 'p', 'a');
    const r = await ex.execute({ id: '1', name: 'memory.recall', arguments: {} }, sig);
    expect(r.isError).toBe(true);
  });
});
