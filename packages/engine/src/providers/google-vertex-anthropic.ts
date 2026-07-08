import { ProviderError, type ModelProvider } from '../provider.js';
import { toVertexAnthropicBody, streamAnthropicEvents, throwAnthropicError } from './anthropic-sse.js';

/** Vertex model-id overrides for Claude entries whose catalog id differs from the Vertex
 *  publisher id used in the URL. Most Claude ids are identity (claude-opus-4-8,
 *  claude-sonnet-4-6). Haiku's catalog id carries a date suffix; the Vertex publisher id
 *  uses the dateless alias. Add overrides here if a catalog id ever diverges. */
const VERTEX_MODEL_ID: Record<string, string> = {
  // Catalog 'claude-haiku-4-5-20251001' → Vertex publisher 'claude-haiku-4-5'.
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
};

/** Claude on Vertex AI (Model Garden) adapter. Same Vertex URL + Bearer (ADC) auth as the
 *  `google-vertex` Gemini adapter, but the Anthropic publisher path and the Anthropic
 *  Messages request/response format. ctx.apiKey is the ADC access token; ctx.baseUrl is the
 *  Vertex anthropic-publisher base
 *  (https://{host}/v1/projects/{p}/locations/{loc}/publishers/anthropic) — required.
 *  Body is the Anthropic Messages body MINUS `model` (it is in the URL) PLUS
 *  `anthropic_version: vertex-2023-10-16`. Response SSE is identical to native Anthropic,
 *  so the parser is reused. */
export const googleVertexAnthropicProvider: ModelProvider = {
  id: 'google-vertex-anthropic',
  async *run(req, ctx, signal) {
    if (!ctx.baseUrl) throw new ProviderError('google-vertex-anthropic requires a Vertex baseUrl', 'permanent');
    const base = ctx.baseUrl.replace(/\/$/, '');
    const modelId = VERTEX_MODEL_ID[req.model] ?? req.model;
    const res = await fetch(`${base}/models/${modelId}:streamRawPredict?alt=sse`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.apiKey}` },
      body: toVertexAnthropicBody(req),
    });
    if (!res.ok || !res.body) await throwAnthropicError(res); // never returns
    yield* streamAnthropicEvents(res);
  },
};
