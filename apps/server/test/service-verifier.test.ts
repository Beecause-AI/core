import { describe, it, expect } from 'vitest';
import { makeServiceVerifier } from '../src/auth/service-verifier.js';

describe('makeServiceVerifier', () => {
  it('bypasses (returns true) when SERVICE_AUDIENCE is unset', async () => {
    const v = makeServiceVerifier({});
    expect(await v(undefined)).toBe(true);
    expect(await v('Bearer whatever')).toBe(true);
  });
  it('denies when audience set but no/invalid token', async () => {
    const v = makeServiceVerifier({ SERVICE_AUDIENCE: 'https://srv.example' });
    expect(await v(undefined)).toBe(false);
    expect(await v('Bearer not-a-real-jwt')).toBe(false);
  });
});
