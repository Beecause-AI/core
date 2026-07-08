import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 32;

/** `scrypt$<saltHex>$<hashHex>` — self-describing, salt per call. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Timing-safe verify. Returns false on any malformed stored value. */
export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
