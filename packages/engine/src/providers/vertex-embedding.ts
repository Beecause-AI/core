import { ProviderError } from '../provider.js';
import type { EmbeddingProvider } from '../embedding.js';

const MODEL = 'text-embedding-004';

/** Vertex AI text-embedding-004 (768-d) via the :predict REST endpoint.
 *  ctx.apiKey is an ADC bearer token; ctx.baseUrl is the publishers/google base. */
export const vertexEmbeddingProvider: EmbeddingProvider = {
  id: 'vertex-embedding',
  async embed(texts, ctx) {
    if (!ctx.baseUrl) throw new ProviderError('vertex-embedding: baseUrl required', 'permanent');
    if (texts.length === 0) return [];
    const base = ctx.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/models/${MODEL}:predict`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instances: texts.map((content) => ({ content })) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const kind = res.status === 429 || res.status >= 500 ? 'temporary' : 'permanent';
      throw new ProviderError(`vertex-embedding ${res.status}: ${detail.slice(0, 300)}`, kind, res.status);
    }
    const json = (await res.json()) as { predictions?: { embeddings?: { values?: number[] } }[] };
    const preds = json.predictions ?? [];
    if (preds.length !== texts.length) {
      throw new ProviderError(
        `vertex-embedding: expected ${texts.length} predictions, got ${preds.length}`,
        'permanent',
      );
    }
    return preds.map((p, i) => {
      const values = p.embeddings?.values;
      if (!values?.length) {
        throw new ProviderError(`vertex-embedding: prediction ${i} has empty or missing values`, 'permanent');
      }
      return values;
    });
  },
};
