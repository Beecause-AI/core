export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

/** USD pricing per 1M tokens, keyed by model id.
 *  OPERATOR: verify/update against current provider pricing before relying on cost numbers.
 *  Unknown models cost 0 (best-effort telemetry, never billing-authoritative). */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Gemini on Vertex (best-effort; verify against current Vertex pricing).
  'gemini-3.1-pro-preview': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-3-flash-preview': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-3.1-flash-lite-preview': { inputPer1M: 0.05, outputPer1M: 0.20 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
  // Anthropic (BYOK).
  'claude-opus-4-8': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5 },
};
