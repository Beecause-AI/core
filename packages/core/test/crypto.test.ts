import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, keyFromBase64 } from '../src/crypto/secrets.js';

describe('secrets crypto', () => {
  const key = randomBytes(32);

  it('derives a key from base64 and rejects wrong sizes', () => {
    const derived = keyFromBase64(key.toString('base64'));
    expect(decryptSecret(encryptSecret('s', derived), derived)).toBe('s');
    expect(() => keyFromBase64('dG9vLXNob3J0')).toThrow('32 bytes');
  });

  it('rejects malformed ciphertext early', () => {
    expect(() => decryptSecret('c2hvcnQ=', key)).toThrow('malformed');
  });

  it('round-trips a secret', () => {
    const ct = encryptSecret('xoxb-slack-token', key);
    expect(ct).not.toContain('xoxb');
    expect(decryptSecret(ct, key)).toBe('xoxb-slack-token');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('a', key)).not.toBe(encryptSecret('a', key));
  });

  it('rejects tampered ciphertext', () => {
    const ct = Buffer.from(encryptSecret('a', key), 'base64');
    ct[ct.length - 1]! ^= 0xff;
    expect(() => decryptSecret(ct.toString('base64'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    const ct = encryptSecret('a', key);
    expect(() => decryptSecret(ct, randomBytes(32))).toThrow();
  });
});
