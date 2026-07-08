import type { ProviderContext } from './provider.js';

/** Produces fixed-dimension vector embeddings for a batch of texts.
 *  Auth is per-call via ctx (mirrors ModelProvider/ProviderContext). */
export interface EmbeddingProvider {
  id: string;
  /** Returns one vector per input text, in order. */
  embed(texts: string[], ctx: ProviderContext): Promise<number[][]>;
}
