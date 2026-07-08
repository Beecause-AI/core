import { type ModelProvider } from '../provider.js';
import { geminiBody, streamGeminiEvents, throwGeminiError } from './gemini-sse.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini Developer API (AI Studio) adapter. Auth via x-goog-api-key. */
export const googleProvider: ModelProvider = {
  id: 'google',
  async *run(req, ctx, signal) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const res = await fetch(`${base}/models/${req.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: geminiBody(req),
    });
    if (!res.ok || !res.body) await throwGeminiError(res); // never returns
    yield* streamGeminiEvents(res);
  },
};
