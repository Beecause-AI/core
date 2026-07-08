import { describe, expect, it } from 'vitest';
import { catalogModelEntries } from './catalog-entries.js';

describe('catalogModelEntries', () => {
  it('registers gemini as a platform entry on google-vertex with google byok fallback', () => {
    const e = catalogModelEntries().find((x) => x.model === 'gemini-3-flash-preview');
    expect(e).toMatchObject({ provider: 'google-vertex', credentialSource: 'platform', byokProvider: 'google', capabilities: { tools: true, streaming: true } });
  });
  it('registers Claude models (opus, haiku) as platform entries on google-vertex-anthropic with anthropic byok fallback', () => {
    const opus = catalogModelEntries().find((x) => x.model === 'claude-opus-4-8');
    expect(opus).toMatchObject({ provider: 'google-vertex-anthropic', credentialSource: 'platform', byokProvider: 'anthropic' });
    expect(catalogModelEntries().find((x) => x.model === 'claude-haiku-4-5-20251001'))
      .toMatchObject({ provider: 'google-vertex-anthropic', credentialSource: 'platform', byokProvider: 'anthropic' });
  });
  it('registers the expanded Vertex Gemini set as platform entries', () => {
    const entries = catalogModelEntries();
    for (const id of ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']) {
      expect(entries.find((e) => e.model === id)).toMatchObject({ provider: 'google-vertex', credentialSource: 'platform', byokProvider: 'google' });
    }
  });
  it('registers claude-sonnet-4-6 as a vertex-anthropic platform entry', () => {
    const e = catalogModelEntries().find((x) => x.model === 'claude-sonnet-4-6');
    expect(e).toMatchObject({ provider: 'google-vertex-anthropic', credentialSource: 'platform', byokProvider: 'anthropic' });
  });
  it('covers every catalog model that has an engine-supported provider', () => {
    const ids = catalogModelEntries().map((e) => e.model);
    expect(ids).toEqual(expect.arrayContaining(['gemini-3-flash-preview', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']));
  });
});
