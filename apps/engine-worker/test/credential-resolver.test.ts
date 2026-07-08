import { describe, expect, it } from 'vitest';
import { makePlatformResolver, vertexBaseUrl } from '../src/engine/credential-resolver.js';
import type { ModelEntry } from '@intellilabs/engine';

const googleEntry: ModelEntry = { model: 'g', provider: 'google', credentialSource: 'platform', cancellation: 'in-flight', capabilities: { tools: false, streaming: true } };
const vertexEntry: ModelEntry = { ...googleEntry, model: 'gemini-3-flash-preview', provider: 'google-vertex' };
const byokEntry: ModelEntry = { ...googleEntry, credentialSource: 'byok' };

describe('vertexBaseUrl', () => {
  it('builds the global publisher base', () => {
    expect(vertexBaseUrl('proj', 'global')).toBe('https://aiplatform.googleapis.com/v1/projects/proj/locations/global/publishers/google');
  });
  it('builds a regional publisher base', () => {
    expect(vertexBaseUrl('proj', 'europe-west1')).toBe('https://europe-west1-aiplatform.googleapis.com/v1/projects/proj/locations/europe-west1/publishers/google');
  });
});

describe('makePlatformResolver — vertex', () => {
  it('resolves a google-vertex entry to the ADC token + vertex base', async () => {
    const r = makePlatformResolver({ vertex: { project: 'proj', location: 'global', getAccessToken: async () => 'ya29.tok' } });
    await expect(r.resolve(vertexEntry, 'org-1')).resolves.toEqual({
      apiKey: 'ya29.tok',
      baseUrl: 'https://aiplatform.googleapis.com/v1/projects/proj/locations/global/publishers/google',
    });
  });
  it('resolves a regional google-vertex entry to the europe-west1 host', async () => {
    const r = makePlatformResolver({ vertex: { project: 'p', location: 'europe-west1', getAccessToken: async () => 'tok' } });
    await expect(r.resolve(vertexEntry, 'org-1')).resolves.toEqual({
      apiKey: 'tok',
      baseUrl: 'https://europe-west1-aiplatform.googleapis.com/v1/projects/p/locations/europe-west1/publishers/google',
    });
  });
  it('actually calls getAccessToken on each resolve (no caching/skipping)', async () => {
    let calls = 0;
    const r = makePlatformResolver({
      vertex: {
        project: 'p',
        location: 'global',
        getAccessToken: async () => {
          calls += 1;
          return `tok-${calls}`;
        },
      },
    });
    await expect(r.resolve(vertexEntry, 'org-1')).resolves.toMatchObject({ apiKey: 'tok-1' });
    await expect(r.resolve(vertexEntry, 'org-1')).resolves.toMatchObject({ apiKey: 'tok-2' });
    expect(calls).toBe(2);
  });
  it('throws permanent when google-vertex has no vertex opts', async () => {
    const r = makePlatformResolver({});
    await expect(r.resolve(vertexEntry, 'org-1')).rejects.toThrow(/vertex not configured/i);
  });
});

describe('makePlatformResolver — google (Developer API) + byok unchanged', () => {
  it('returns the gemini key for a platform google entry', async () => {
    const r = makePlatformResolver({ geminiApiKey: 'plat-key' });
    await expect(r.resolve(googleEntry, 'o')).resolves.toEqual({ apiKey: 'plat-key', baseUrl: undefined });
  });
  it('throws for byok', async () => {
    const r = makePlatformResolver({ geminiApiKey: 'k' });
    await expect(r.resolve(byokEntry, 'o')).rejects.toThrow(/byok/i);
  });
  it('throws when a platform google entry has no key', async () => {
    const r = makePlatformResolver({});
    await expect(r.resolve(googleEntry, 'o')).rejects.toThrow(/no platform key/i);
  });
});
