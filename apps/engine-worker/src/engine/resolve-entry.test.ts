import { describe, expect, it } from 'vitest';
import { ModelRegistry } from '@intellilabs/engine';
import { makeResolveEntry } from './resolve-entry.js';

const registry = new ModelRegistry([
  { model: 'claude-sonnet-4-6', provider: 'anthropic', credentialSource: 'platform', cancellation: 'in-flight', capabilities: { tools: true, streaming: true }, byokProvider: 'anthropic' },
]);
const fakeDb = {} as any;

describe('makeResolveEntry with explicit provider', () => {
  it('forces platform when provider="platform" even if a byok key is enabled', async () => {
    const resolve = makeResolveEntry(registry, fakeDb, true, async () => true);
    const e = await resolve('claude-sonnet-4-6', 'org1', 'platform');
    expect(e.credentialSource).toBe('platform');
  });

  it('uses byok when provider omitted and a key is enabled (existing behaviour)', async () => {
    const resolve = makeResolveEntry(registry, fakeDb, true, async () => true);
    const e = await resolve('claude-sonnet-4-6', 'org1', undefined);
    expect(e.credentialSource).toBe('byok');
  });

  it('forces a byok provider when explicitly requested and key enabled', async () => {
    const resolve = makeResolveEntry(registry, fakeDb, true, async () => true);
    const e = await resolve('claude-sonnet-4-6', 'org1', 'anthropic');
    expect(e.credentialSource).toBe('byok');
    expect(e.provider).toBe('anthropic');
  });

  it('falls back to platform when a requested byok provider has no enabled key', async () => {
    const resolve = makeResolveEntry(registry, fakeDb, true, async () => false);
    const e = await resolve('claude-sonnet-4-6', 'org1', 'anthropic');
    expect(e.credentialSource).toBe('platform');
  });

  it('synthesizes a byok entry for an unknown model id with an explicit provider', async () => {
    const resolve = makeResolveEntry(registry, fakeDb, true, async () => true);
    const e = await resolve('some-live-model-x', 'org1', 'openai-compatible');
    expect(e).toMatchObject({ model: 'some-live-model-x', provider: 'openai-compatible', credentialSource: 'byok' });
  });

  it('still throws for a genuinely unknown model with no provider', async () => {
    const resolve = makeResolveEntry(registry, fakeDb, true, async () => true);
    await expect(resolve('totally-unknown', 'org1', undefined)).rejects.toThrow(/unknown model/);
  });
});
