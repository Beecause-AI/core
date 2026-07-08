import { afterEach, describe, expect, it, vi } from 'vitest';
import { vertexEmbeddingProvider } from '../src/providers/vertex-embedding.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('vertexEmbeddingProvider', () => {
  it('POSTs to the correct URL, sends Bearer auth, and maps predictions to vectors', async () => {
    const mockResponse = {
      predictions: [
        { embeddings: { values: [0.1, 0.2, 0.3] } },
        { embeddings: { values: [0.4, 0.5, 0.6] } },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await vertexEmbeddingProvider.embed(
      ['a', 'b'],
      { apiKey: 'tok', baseUrl: 'https://vertex.example.com/v1/publishers/google' },
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/text-embedding-004:predict');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ instances: [{ content: 'a' }, { content: 'b' }] });
    expect(result).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
  });

  it('throws when baseUrl is missing', async () => {
    await expect(vertexEmbeddingProvider.embed(['hello'], { apiKey: 'tok' }))
      .rejects.toThrow(/baseUrl/);
  });

  it('returns [] and does NOT call fetch when texts is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await vertexEmbeddingProvider.embed(
      [],
      { apiKey: 'tok', baseUrl: 'https://vertex.example.com/v1/publishers/google' },
    );
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects with ProviderError on non-ok HTTP response (500)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );
    await expect(
      vertexEmbeddingProvider.embed(['hello'], { apiKey: 'tok', baseUrl: 'https://vertex.example.com/v1/publishers/google' }),
    ).rejects.toMatchObject({ name: 'ProviderError', kind: 'temporary', status: 500 });
  });

  it('rejects on prediction-count mismatch', async () => {
    const mockResponse = {
      predictions: [
        { embeddings: { values: [0.1, 0.2, 0.3] } },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(
      vertexEmbeddingProvider.embed(['a', 'b'], { apiKey: 'tok', baseUrl: 'https://vertex.example.com/v1/publishers/google' }),
    ).rejects.toMatchObject({ name: 'ProviderError', message: /expected 2 predictions, got 1/ });
  });
});
