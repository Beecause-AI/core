import { describe, expect, it } from 'vitest';
import { buildModelGroups } from '../src/routes/models-groups.js';

describe('buildModelGroups', () => {
  it('always includes a platform group of curated platform models', () => {
    const groups = buildModelGroups({ keys: [] });
    const platform = groups.find((g) => g.provider === 'platform');
    expect(platform).toBeDefined();
    expect(platform!.models.map((m) => m.id)).toContain('gemini-3-flash-preview');
    expect(platform!.models[0]?.origin).toBe('curated');
  });

  it('adds a group per enabled byok provider with curated models', () => {
    const groups = buildModelGroups({ keys: [{ provider: 'anthropic', enabled: true, baseUrl: null }] });
    const anthropic = groups.find((g) => g.provider === 'anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.source).toBe('byok');
    expect(anthropic!.models.map((m) => m.id)).toContain('claude-opus-4-8');
  });

  it('skips disabled keys', () => {
    const groups = buildModelGroups({ keys: [{ provider: 'anthropic', enabled: false, baseUrl: null }] });
    expect(groups.find((g) => g.provider === 'anthropic')).toBeUndefined();
  });

  it('marks openai-compatible groups as freeEntry with their baseUrl', () => {
    const groups = buildModelGroups({ keys: [{ provider: 'openai-compatible', enabled: true, baseUrl: 'https://or.example/v1' }] });
    const custom = groups.find((g) => g.provider === 'openai-compatible');
    expect(custom!.freeEntry).toBe(true);
    expect(custom!.custom?.baseUrl).toBe('https://or.example/v1');
  });

  it('populates alsoOn for a model offered by two providers', () => {
    const groups = buildModelGroups({ keys: [] });
    const geminiOnPlatform = groups.find((g) => g.provider === 'platform')!.models.find((m) => m.id === 'gemini-3-flash-preview');
    expect(geminiOnPlatform?.alsoOn).toContain('google');
  });

  it('merges live ids not in the catalog, marked origin=live', () => {
    const groups = buildModelGroups({
      keys: [{ provider: 'anthropic', enabled: true, baseUrl: null }],
      live: { anthropic: ['claude-opus-4-8', 'claude-brand-new'] },
    });
    const anthropic = groups.find((g) => g.provider === 'anthropic')!;
    const fresh = anthropic.models.find((m) => m.id === 'claude-brand-new');
    expect(fresh?.origin).toBe('live');
  });
});
