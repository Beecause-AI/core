import { type ModelProvider } from '../provider.js';
import { toAnthropicBody, streamAnthropicEvents, throwAnthropicError } from './anthropic-sse.js';

const DEFAULT_BASE = 'https://api.anthropic.com/v1';

/** Anthropic Claude Messages API adapter. Auth via x-api-key + anthropic-version. */
export const anthropicProvider: ModelProvider = {
  id: 'anthropic',
  async *run(req, ctx, signal) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' },
      body: toAnthropicBody(req),
    });
    if (!res.ok || !res.body) await throwAnthropicError(res); // never returns
    yield* streamAnthropicEvents(res);
  },
};
