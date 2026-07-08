import { ProviderError, type ModelProvider } from '../provider.js';
import { geminiBody, streamGeminiEvents, throwGeminiError } from './gemini-sse.js';

/** Vertex AI Gemini adapter. The Vertex URL + Bearer auth differ from the Developer-API
 *  `google` adapter; the SSE response shape is identical (shared parser). ctx.apiKey is
 *  the ADC access token; ctx.baseUrl is the Vertex publisher base
 *  (https://{host}/v1/projects/{p}/locations/{loc}/publishers/google) — required (no
 *  Developer-API fallback). */
export const googleVertexProvider: ModelProvider = {
  id: 'google-vertex',
  async *run(req, ctx, signal) {
    if (!ctx.baseUrl) throw new ProviderError('google-vertex requires a Vertex baseUrl', 'permanent');
    const base = ctx.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/models/${req.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.apiKey}` },
      body: geminiBody(req),
    });
    if (!res.ok || !res.body) await throwGeminiError(res); // never returns
    yield* streamGeminiEvents(res);
  },
};
