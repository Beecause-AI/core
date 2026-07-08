import { describe, expect, it } from 'vitest';
import { listProviderModels } from '../src/providers/list-models.js';

const okFetch = (body: unknown) => (async () => ({ ok: true, status: 200, json: async () => body } as any));

describe('listProviderModels', () => {
  it('parses anthropic { data: [{ id }] }', async () => {
    const r = await listProviderModels('anthropic', 'k', { fetchImpl: okFetch({ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-foo' }] }) });
    expect(r.ok).toBe(true);
    expect(r.ids).toEqual(['claude-opus-4-8', 'claude-foo']);
  });

  it('parses openai { data: [{ id }] }', async () => {
    const r = await listProviderModels('openai', 'k', { fetchImpl: okFetch({ data: [{ id: 'gpt-5.1' }] }) });
    expect(r.ids).toEqual(['gpt-5.1']);
  });

  it('parses google { models: [{ name: "models/gemini-x" }] } stripping the prefix', async () => {
    const r = await listProviderModels('google', 'k', { fetchImpl: okFetch({ models: [{ name: 'models/gemini-3-flash-preview' }] }) });
    expect(r.ids).toEqual(['gemini-3-flash-preview']);
  });

  it('maps a 401 to a clean error and no ids', async () => {
    const r = await listProviderModels('anthropic', 'bad', { fetchImpl: (async () => ({ ok: false, status: 401, json: async () => ({}) })) as any });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/rejected/i);
    expect(r.ids).toEqual([]);
  });
});
