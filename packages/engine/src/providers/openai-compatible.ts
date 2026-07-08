import { type ModelProvider } from '../provider.js';
import { toOpenAIBody, streamOpenAIEvents, throwOpenAIError } from './openai-compatible-sse.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';

/** Adapter for any OpenAI-Chat-Completions-compatible endpoint: OpenAI itself plus
 *  OSS runtimes (vLLM, Ollama, LM Studio, Together, OpenRouter). Streams SSE. */
export const openaiCompatible: ModelProvider = {
  id: 'openai-compatible',
  async *run(req, ctx, signal) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.apiKey}` },
      body: toOpenAIBody(req),
    });
    if (!res.ok || !res.body) await throwOpenAIError(res); // never returns
    yield* streamOpenAIEvents(res);
  },
};
