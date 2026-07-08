import { describe, expect, it } from 'vitest';
import { CATALOG, catalogByProvider, modelsAlsoOn, PROVIDER_IDS } from './catalog.js';

describe('model catalog', () => {
  it('has unique model ids', () => {
    const ids = CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every model lists at least one known provider', () => {
    for (const m of CATALOG) {
      expect(m.providers.length).toBeGreaterThan(0);
      for (const p of m.providers) expect(PROVIDER_IDS).toContain(p);
    }
  });

  it('catalogByProvider returns only models offered by that provider', () => {
    const anthropic = catalogByProvider('anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    for (const m of anthropic) expect(m.providers).toContain('anthropic');
  });

  it('modelsAlsoOn reports other providers offering the same id', () => {
    // Gemini is offered on both the platform (Vertex) and a Google AI Studio BYOK key.
    expect(modelsAlsoOn('gemini-3-flash-preview', 'platform')).toContain('google');
    expect(modelsAlsoOn('gemini-3-flash-preview', 'google')).toContain('platform');
  });
});
