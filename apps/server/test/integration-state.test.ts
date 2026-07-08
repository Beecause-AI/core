import { describe, expect, it } from 'vitest';
import { signState, verifyState, newNonce, type StatePayload } from '../src/integrations/state.js';

const SECRET = 's'.repeat(40);
const base = (): StatePayload => ({ orgId: 'o1', slug: 'acme', provider: 'github', userId: 'u1', nonce: 'n1', exp: Math.floor(Date.now() / 1000) + 600 });

describe('signState / verifyState', () => {
  it('round-trips a valid payload', () => {
    const token = signState(base(), SECRET);
    expect(verifyState(token, SECRET)).toMatchObject({ orgId: 'o1', slug: 'acme', nonce: 'n1' });
  });

  it('rejects a tampered body', () => {
    const token = signState(base(), SECRET);
    const [body, sig] = token.split('.');
    const forged = `${body}x.${sig}`;
    expect(verifyState(forged, SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    expect(verifyState(signState(base(), SECRET), 'other-secret-other-secret-other-secret')).toBeNull();
  });

  it('rejects an expired payload', () => {
    const token = signState({ ...base(), exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    expect(verifyState(token, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyState('garbage', SECRET)).toBeNull();
    expect(verifyState('', SECRET)).toBeNull();
  });

  it('newNonce returns distinct hex strings', () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[0-9a-f]{36}$/);
  });
});
