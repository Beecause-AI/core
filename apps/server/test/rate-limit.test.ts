import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from '../src/auth/rate-limit.js';

describe('TokenBucketLimiter', () => {
  it('allows up to `capacity` hits, then refuses', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 5, refillPerMs: 5 / 60_000, now: () => now });
    for (let i = 0; i < 5; i++) expect(limiter.tryConsume('1.2.3.4')).toBe(true);
    expect(limiter.tryConsume('1.2.3.4')).toBe(false);
  });
  it('refills over time', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 5, refillPerMs: 5 / 60_000, now: () => now });
    for (let i = 0; i < 5; i++) limiter.tryConsume('k');
    now += 12_000; // 1 token refilled at 5/min
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);
  });
  it('tracks keys independently', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerMs: 0, now: () => 0 });
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('b')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
  });
});
