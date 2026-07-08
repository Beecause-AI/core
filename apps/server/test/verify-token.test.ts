import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createVerifyToken, verifyVerifyToken } from '../src/auth/session.js';

const secret = 's'.repeat(32);

describe('verify token', () => {
  it('round-trips slug + email + name', async () => {
    const t = await createVerifyToken({ slug: 'acme', email: 'a@b.co', name: 'Ada L' }, secret);
    expect(await verifyVerifyToken(t, secret)).toEqual({ slug: 'acme', email: 'a@b.co', name: 'Ada L' });
  });
  it('rejects a token signed with a different secret', async () => {
    const t = await createVerifyToken({ slug: 'acme', email: 'a@b.co', name: 'A' }, secret);
    expect(await verifyVerifyToken(t, 'x'.repeat(32))).toBeNull();
  });
  it('rejects a session token presented as a verify token (wrong kind)', async () => {
    const { createSessionToken } = await import('../src/auth/session.js');
    const s = await createSessionToken({ sub: 'u1' }, secret);
    expect(await verifyVerifyToken(s, secret)).toBeNull();
  });
  it('rejects a token missing required claims (legacy kcUserId shape)', async () => {
    const legacy = await new SignJWT({ kind: 'verify', kcUserId: 'u1', email: 'a@b.co' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    expect(await verifyVerifyToken(legacy, secret)).toBeNull();
  });
});
