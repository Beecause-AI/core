import { describe, it, expect, vi } from 'vitest';
import { RecentSearchToolExecutor } from '../src/tools/recent.js';

const exec = (client: { search: any }) => new RecentSearchToolExecutor(client, 'o', 'p', 'cur');

describe('recent.search', () => {
  it('advertises recent.search only when requested and project is set', () => {
    const e = exec({ search: vi.fn() });
    expect(e.toToolDefs(['recent.search']).map((d) => d.name)).toEqual(['recent.search']);
    expect(e.toToolDefs([]).length).toBe(0);
  });

  it('requires a query string', async () => {
    const e = exec({ search: vi.fn() });
    const r = await e.execute({ id: '1', name: 'recent.search', arguments: {} }, new AbortController().signal);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('query');
  });

  it('delegates to client.search and returns its content', async () => {
    const search = vi.fn(async () => '- [open] Postgres pool exhausted');
    const e = exec({ search });
    const r = await e.execute({ id: '1', name: 'recent.search', arguments: { query: 'db pool', limit: 3 } }, new AbortController().signal);
    expect(search).toHaveBeenCalledWith('o', 'p', 'db pool', 'cur', 3);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Postgres pool');
  });

  it('projectId absent → toToolDefs returns []', () => {
    const e = new RecentSearchToolExecutor({ search: vi.fn() }, 'o', undefined, undefined);
    expect(e.toToolDefs(['recent.search']).length).toBe(0);
  });

  it('projectId absent → execute returns an error result', async () => {
    const e = new RecentSearchToolExecutor({ search: vi.fn() }, 'o', undefined, undefined);
    const r = await e.execute({ id: '1', name: 'recent.search', arguments: { query: 'x' } }, new AbortController().signal);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('not available');
  });

  it('client throws → isError', async () => {
    const search = vi.fn(async () => {
      throw new Error('boom');
    });
    const e = exec({ search });
    const r = await e.execute({ id: '1', name: 'recent.search', arguments: { query: 'x' } }, new AbortController().signal);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('boom');
  });

  it('undefined limit is threaded as undefined', async () => {
    const search = vi.fn(async () => '- past incident');
    const e = exec({ search });
    const r = await e.execute({ id: '1', name: 'recent.search', arguments: { query: 'x' } }, new AbortController().signal);
    expect(search).toHaveBeenCalledWith('o', 'p', 'x', 'cur', undefined);
    expect(r.isError).toBe(false);
  });
});
