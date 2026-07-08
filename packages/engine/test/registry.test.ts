import { describe, expect, it } from 'vitest';
import {
  ModelRegistry,
  breakerKeyFor,
  type ModelEntry,
  type CredentialResolver,
  type ProviderContextResolved,
} from '../src/registry.js';

const googleEntry: ModelEntry = {
  model: 'gemini-3-flash-preview',
  provider: 'google',
  credentialSource: 'platform',
  cancellation: 'in-flight',
  capabilities: { tools: true, streaming: true },
};

const ossEntry: ModelEntry = {
  model: 'llama-3.1-70b',
  provider: 'openai-compatible',
  baseUrl: 'http://oss.internal/v1',
  credentialSource: 'byok',
  cancellation: 'boundary-only',
  capabilities: { tools: false, streaming: true },
};

describe('ModelRegistry.get', () => {
  it('returns a known entry', () => {
    const registry = new ModelRegistry([googleEntry, ossEntry]);
    expect(registry.get('gemini-3-flash-preview')).toBe(googleEntry);
    expect(registry.get('llama-3.1-70b')).toBe(ossEntry);
  });

  it('throws /unknown model/i including the model name', () => {
    const registry = new ModelRegistry([googleEntry]);
    expect(() => registry.get('does-not-exist')).toThrow(/unknown model/i);
    expect(() => registry.get('does-not-exist')).toThrow(/does-not-exist/);
  });

  it('throws unknown-model on an empty registry', () => {
    const registry = new ModelRegistry([]);
    expect(() => registry.get('x')).toThrow(/unknown model/i);
    expect(() => registry.get('x')).toThrow(/x/);
  });

  it('last entry wins on duplicate model ids (documents Map semantics)', () => {
    const first: ModelEntry = { ...googleEntry, provider: 'google' };
    const last: ModelEntry = { ...googleEntry, provider: 'openai-compatible' };
    const registry = new ModelRegistry([first, last]);
    expect(registry.get('gemini-3-flash-preview')).toBe(last);
    expect(registry.get('gemini-3-flash-preview').provider).toBe('openai-compatible');
  });

  it('round-trips entries with and without baseUrl unchanged (deep-equal)', () => {
    const registry = new ModelRegistry([googleEntry, ossEntry]);
    // google: no baseUrl
    expect(registry.get('gemini-3-flash-preview')).toEqual(googleEntry);
    expect(registry.get('gemini-3-flash-preview').baseUrl).toBeUndefined();
    // openai-compatible: with baseUrl
    expect(registry.get('llama-3.1-70b')).toEqual(ossEntry);
    expect(registry.get('llama-3.1-70b').baseUrl).toBe('http://oss.internal/v1');
  });
});

describe('breakerKeyFor', () => {
  it('uses a shared "platform" scope for a platform entry', () => {
    expect(breakerKeyFor(googleEntry, 'org-1')).toBe('google:gemini-3-flash-preview:platform');
  });

  it('uses the orgId as scope for a byok entry', () => {
    expect(breakerKeyFor(ossEntry, 'org-1')).toBe('openai-compatible:llama-3.1-70b:org-1');
  });

  it('isolates byok per org but shares platform across orgs', () => {
    // byok: two different orgs => two different keys
    const byokA = breakerKeyFor(ossEntry, 'org-a');
    const byokB = breakerKeyFor(ossEntry, 'org-b');
    expect(byokA).not.toBe(byokB);
    expect(byokA).toBe('openai-compatible:llama-3.1-70b:org-a');
    expect(byokB).toBe('openai-compatible:llama-3.1-70b:org-b');

    // platform: two different orgs => the SAME key (shared breaker)
    const platformA = breakerKeyFor(googleEntry, 'org-a');
    const platformB = breakerKeyFor(googleEntry, 'org-b');
    expect(platformA).toBe(platformB);
    expect(platformA).toBe('google:gemini-3-flash-preview:platform');
  });
});

describe('CredentialResolver', () => {
  it('is implementable and returns a ProviderContextResolved (platform key)', async () => {
    const resolver: CredentialResolver = {
      async resolve(): Promise<ProviderContextResolved> {
        return { apiKey: 'k' };
      },
    };
    const ctx = await resolver.resolve(googleEntry, 'org');
    expect(ctx).toEqual({ apiKey: 'k' });
    expect(ctx.baseUrl).toBeUndefined();
  });

  it('is implementable and returns a ProviderContextResolved with baseUrl (byok/self-hosted)', async () => {
    const resolver: CredentialResolver = {
      async resolve(entry: ModelEntry): Promise<ProviderContextResolved> {
        return { apiKey: 'k', baseUrl: entry.baseUrl ?? 'http://x' };
      },
    };
    const ctx = await resolver.resolve(ossEntry, 'org');
    expect(ctx).toEqual({ apiKey: 'k', baseUrl: 'http://oss.internal/v1' });
  });
});
