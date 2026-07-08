import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/provider.js';
import {
  classifyError,
  canAttempt,
  onSuccess,
  onTemporaryFailure,
  onRateLimit,
  FAILURE_THRESHOLD,
  RATE_LIMIT_THRESHOLD,
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  type Breaker,
} from '../src/breaker.js';

const T0 = new Date('2026-06-08T00:00:00.000Z');
function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

describe('classifyError', () => {
  it('respects ProviderError.kind (temporary, permanent, rate_limited)', () => {
    expect(classifyError(new ProviderError('temp', 'temporary', 503))).toBe('temporary');
    expect(classifyError(new ProviderError('bad', 'permanent', 400))).toBe('permanent');
    expect(classifyError(new ProviderError('rate', 'rate_limited', 429))).toBe('rate_limited');
  });

  it('maps a 429 status to rate_limited (an authoritative back-off signal)', () => {
    expect(classifyError({ status: 429 })).toBe('rate_limited');
  });

  it('maps the other temporary HTTP statuses to temporary', () => {
    for (const status of [408, 425, 500, 502, 503, 504]) {
      expect(classifyError({ status })).toBe('temporary');
    }
  });

  it('maps non-temporary HTTP statuses to permanent', () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(classifyError({ status })).toBe('permanent');
    }
  });

  it('maps known network codes to temporary', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']) {
      expect(classifyError({ code })).toBe('temporary');
    }
  });

  it('treats unknown errors as permanent (fail fast, do not mask bugs)', () => {
    expect(classifyError(new TypeError('bug'))).toBe('permanent');
    expect(classifyError('a string')).toBe('permanent');
    expect(classifyError(null)).toBe('permanent');
    expect(classifyError(undefined)).toBe('permanent');
    expect(classifyError({})).toBe('permanent');
    expect(classifyError({ code: 'ENOTANETWORKCODE' })).toBe('permanent');
  });

  it('gives status precedence over code', () => {
    // permanent status wins even if a temporary code is present
    expect(classifyError({ status: 400, code: 'ECONNRESET' })).toBe('permanent');
    // temporary status is honoured with no code
    expect(classifyError({ status: 503 })).toBe('temporary');
  });
});

describe('circuit breaker state machine', () => {
  it('opens after exactly FAILURE_THRESHOLD consecutive temporary failures', () => {
    let b: Breaker | null = null;
    for (let i = 1; i < FAILURE_THRESHOLD; i++) {
      b = onTemporaryFailure(b, T0);
      expect(b.state).toBe('closed');
      expect(b.failures).toBe(i);
      expect(b.openedAt).toBeNull();
      expect(b.nextProbeAt).toBeNull();
    }
    // the FAILURE_THRESHOLD-th failure flips to open
    b = onTemporaryFailure(b, T0);
    expect(b.state).toBe('open');
    expect(b.failures).toBe(FAILURE_THRESHOLD);
    expect(b.openedAt).toEqual(T0);
    expect(b.nextProbeAt).toEqual(new Date(T0.getTime() + BASE_COOLDOWN_MS));
  });

  it('threshold boundary: threshold-1 stays closed, the next flips open', () => {
    let b: Breaker | null = null;
    for (let i = 1; i < FAILURE_THRESHOLD; i++) b = onTemporaryFailure(b, T0);
    expect(b!.state).toBe('closed');
    expect(b!.failures).toBe(FAILURE_THRESHOLD - 1);
    expect(canAttempt(b, T0)).toBe(true);

    b = onTemporaryFailure(b, T0);
    expect(b.state).toBe('open');
    expect(canAttempt(b, T0)).toBe(false);
  });

  it('first failure from null starts failures at 1 and stays closed', () => {
    const b = onTemporaryFailure(null, T0);
    expect(b.failures).toBe(1);
    expect(b.state).toBe('closed');
    expect(b.openedAt).toBeNull();
    expect(b.nextProbeAt).toBeNull();
  });

  it('onTemporaryFailure is pure / does not mutate its input', () => {
    const input: Breaker = Object.freeze({
      state: 'closed',
      failures: 2,
      openedAt: null,
      nextProbeAt: null,
    });
    let result: Breaker;
    expect(() => {
      result = onTemporaryFailure(input, T0);
    }).not.toThrow();
    expect(result!).not.toBe(input);
    expect(result!.failures).toBe(3);
    expect(input.failures).toBe(2); // unchanged
  });
});

describe('onRateLimit (429 back-off)', () => {
  it('opens after RATE_LIMIT_THRESHOLD failures — faster than the generic threshold', () => {
    expect(RATE_LIMIT_THRESHOLD).toBeLessThan(FAILURE_THRESHOLD);
    let b: Breaker | null = null;
    for (let i = 1; i < RATE_LIMIT_THRESHOLD; i++) {
      b = onRateLimit(b, T0);
      expect(b.state).toBe('closed');
      expect(b.failures).toBe(i);
    }
    b = onRateLimit(b, T0);
    expect(b.state).toBe('open');
    expect(b.failures).toBe(RATE_LIMIT_THRESHOLD);
    expect(b.openedAt).toEqual(T0);
  });

  it('honors retry-after as the cooldown when opening', () => {
    let b: Breaker | null = null;
    for (let i = 1; i < RATE_LIMIT_THRESHOLD; i++) b = onRateLimit(b, T0);
    const retryAfterMs = 7_000;
    b = onRateLimit(b, T0, retryAfterMs);
    expect(b.state).toBe('open');
    expect(b.nextProbeAt).toEqual(new Date(T0.getTime() + retryAfterMs));
  });

  it('clamps an over-long retry-after to MAX_COOLDOWN_MS', () => {
    let b: Breaker | null = null;
    for (let i = 1; i < RATE_LIMIT_THRESHOLD; i++) b = onRateLimit(b, T0);
    b = onRateLimit(b, T0, MAX_COOLDOWN_MS * 10);
    expect(b.nextProbeAt!.getTime() - b.openedAt!.getTime()).toBe(MAX_COOLDOWN_MS);
  });

  it('falls back to the exponential cooldown when no retry-after is given', () => {
    let b: Breaker | null = null;
    for (let i = 0; i < RATE_LIMIT_THRESHOLD; i++) b = onRateLimit(b, T0);
    expect(b!.nextProbeAt!.getTime() - b!.openedAt!.getTime()).toBe(BASE_COOLDOWN_MS);
  });

  it('stays open when a generic temporary failure follows a rate-limit open', () => {
    // Cross-class guard: rate-limit opens at the lower threshold; a later 500 must not
    // reset failures below FAILURE_THRESHOLD and silently close the breaker.
    let b: Breaker | null = null;
    for (let i = 0; i < RATE_LIMIT_THRESHOLD; i++) b = onRateLimit(b, T0);
    expect(b!.state).toBe('open');
    b = onTemporaryFailure(b, b!.nextProbeAt!);
    expect(b.state).toBe('open');
  });

  it('is pure / does not mutate its input', () => {
    const input: Breaker = Object.freeze({ state: 'closed', failures: 1, openedAt: null, nextProbeAt: null });
    const result = onRateLimit(input, T0);
    expect(result).not.toBe(input);
    expect(input.failures).toBe(1);
  });
});

describe('canAttempt', () => {
  it('is true for null and for a closed breaker', () => {
    expect(canAttempt(null, T0)).toBe(true);
    expect(canAttempt({ state: 'closed', failures: 0, openedAt: null, nextProbeAt: null }, T0)).toBe(true);
  });

  it('is false while open before nextProbeAt and true once now >= nextProbeAt', () => {
    let b: Breaker | null = null;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) b = onTemporaryFailure(b, T0);
    const probeAt = b!.nextProbeAt!;
    // just before
    expect(canAttempt(b, new Date(probeAt.getTime() - 1))).toBe(false);
    // exactly at (inclusive boundary)
    expect(canAttempt(b, new Date(probeAt.getTime()))).toBe(true);
    // after
    expect(canAttempt(b, new Date(probeAt.getTime() + 1))).toBe(true);
  });
});

describe('onSuccess', () => {
  it('closes the breaker and re-enables attempts', () => {
    let b: Breaker | null = null;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) b = onTemporaryFailure(b, T0);
    expect(b!.state).toBe('open');

    const closed = onSuccess(b);
    expect(closed.state).toBe('closed');
    // invariant: a successful probe resolves to 'closed', never the implicit 'half_open'.
    expect(closed.state).not.toBe('half_open');
    expect(closed.failures).toBe(0);
    expect(closed.openedAt).toBeNull();
    expect(closed.nextProbeAt).toBeNull();
    expect(canAttempt(closed, T0)).toBe(true);
  });
});

describe('cooldown growth', () => {
  function expectedCooldown(failures: number): number {
    const over = Math.max(0, failures - FAILURE_THRESHOLD);
    return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** over);
  }

  it('a failed probe reopens with a longer cooldown than the first open', () => {
    let b: Breaker | null = null;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) b = onTemporaryFailure(b, T0);
    const firstGap = b!.nextProbeAt!.getTime() - b!.openedAt!.getTime();
    expect(firstGap).toBe(BASE_COOLDOWN_MS);

    // probe fails: another temporary failure at probe time
    const probeTime = b!.nextProbeAt!;
    b = onTemporaryFailure(b, probeTime);
    expect(b.state).toBe('open');
    // invariant: the pure logic models the failed half-open probe as a reopen,
    // it never emits the implicit 'half_open' state.
    expect(b.state).not.toBe('half_open');
    const secondGap = b.nextProbeAt!.getTime() - b.openedAt!.getTime();
    expect(secondGap).toBeGreaterThan(firstGap);
    expect(secondGap).toBe(BASE_COOLDOWN_MS * 2);
  });

  it('is exponential and capped at MAX_COOLDOWN_MS as failures climb', () => {
    let b: Breaker | null = null;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) b = onTemporaryFailure(b, T0);

    for (let failures = FAILURE_THRESHOLD; failures <= FAILURE_THRESHOLD + 10; failures++) {
      const gap = b!.nextProbeAt!.getTime() - b!.openedAt!.getTime();
      expect(gap).toBe(expectedCooldown(failures));
      expect(gap).toBeLessThanOrEqual(MAX_COOLDOWN_MS);
      // drive the next failure
      b = onTemporaryFailure(b, b!.nextProbeAt!);
    }
    // well past threshold it is firmly pinned at the cap
    expect(b!.nextProbeAt!.getTime() - b!.openedAt!.getTime()).toBe(MAX_COOLDOWN_MS);
  });
});
