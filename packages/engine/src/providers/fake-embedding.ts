import type { EmbeddingProvider } from '../embedding.js';

/** Deterministic test double: a `dim`-length vector per text whose first
 *  component encodes text length (lets tests assert ordering/shape). */
export function fakeEmbeddingProvider(dim = 768): EmbeddingProvider {
  return {
    id: 'fake-embedding',
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array(dim).fill(0);
        v[0] = t.length;
        return v;
      });
    },
  };
}
