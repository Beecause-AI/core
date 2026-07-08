import { MODEL_PRICES, type ModelPrice } from '@intellilabs/core';

export { MODEL_PRICES, type ModelPrice };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
}
