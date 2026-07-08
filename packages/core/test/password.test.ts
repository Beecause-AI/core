import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/crypto/password.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: correct password verifies true', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', stored)).toBe(true);
  });

  it('wrong password verifies false', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('malformed stored value returns false', () => {
    expect(verifyPassword('password', 'not-a-valid-stored-value')).toBe(false);
    expect(verifyPassword('password', '')).toBe(false);
    expect(verifyPassword('password', undefined)).toBe(false);
    expect(verifyPassword('password', 'scrypt$')).toBe(false);
    expect(verifyPassword('password', 'bcrypt$abc$def')).toBe(false);
  });

  it('two hashes of the same password differ (random salt)', () => {
    const h1 = hashPassword('same-password');
    const h2 = hashPassword('same-password');
    expect(h1).not.toBe(h2);
    // But both verify correctly
    expect(verifyPassword('same-password', h1)).toBe(true);
    expect(verifyPassword('same-password', h2)).toBe(true);
  });

  it('stored value has the expected scrypt$ prefix format', () => {
    const stored = hashPassword('test');
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  });
});
