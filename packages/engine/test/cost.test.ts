import { describe, expect, it } from 'vitest';
import { costUsd } from '../src/cost.js';

describe('costUsd', () => {
  it('computes input+output cost from the price table', () => {
    const c = costUsd('gemini-3-flash-preview', 1_000_000, 1_000_000);
    expect(c).toBeCloseTo(0.375, 6);
  });
  it('returns 0 for an unknown model', () => {
    expect(costUsd('no-such-model', 1000, 1000)).toBe(0);
  });
  it('scales linearly with token counts', () => {
    expect(costUsd('gemini-3-flash-preview', 500_000, 0)).toBeCloseTo(0.0375, 6);
  });
});
