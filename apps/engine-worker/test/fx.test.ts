// apps/engine-worker/test/fx.test.ts
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { currentUsdEurRate, refreshUsdEurRate } from '../src/engine/fx.js';
import { testStore } from '../../../packages/core/test/store/emulator.js';

const t = testStore('fx');
afterAll(() => t.close());

describe('currentUsdEurRate', () => {
  it('returns the fallback before any refresh has populated the memo', () => {
    expect(currentUsdEurRate(0.92)).toBe(0.92);
  });
});

describe('refreshUsdEurRate', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates the in-process memo when ECB returns a valid rate', async () => {
    // Pin "today" to a past date so the memo guard never short-circuits on a real date collision.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2020-01-15T12:00:00Z'));

    const ecbXml = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time="2020-01-15">
  <Cube currency='USD' rate='1.08'/>
</Cube></Cube></gesmes:Envelope>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(ecbXml) }));

    await refreshUsdEurRate(t.db, 0.92);

    // ECB reports 1 EUR = 1.08 USD  →  USD→EUR = 1/1.08 ≈ 0.9259
    const rate = currentUsdEurRate(0.92);
    expect(rate).toBeCloseTo(1 / 1.08, 4);
    expect(rate).not.toBe(0.92);
  });
});
