import { describe, expect, it } from 'vitest';
import { creditTopupBody } from '../src/routes/billing.js';

// The route validates amountCents ∈ [1000, 200000]. Assert the shared schema directly (no live Stripe).

describe('credits checkout body validation', () => {
  it('accepts €25 / €100 / €500 and a custom in-range amount', () => {
    for (const v of [2500, 10000, 50000, 1500]) expect(creditTopupBody.parse({ amountCents: v }).amountCents).toBe(v);
  });
  it('rejects below €10 and above €2000', () => {
    expect(() => creditTopupBody.parse({ amountCents: 500 })).toThrow();
    expect(() => creditTopupBody.parse({ amountCents: 300000 })).toThrow();
  });
});
