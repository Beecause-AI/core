import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type StatePayload = { orgId: string; slug: string; provider: string; userId: string; nonce: string; exp: number };

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function newNonce(): string { return randomBytes(18).toString('hex'); }

export function signState(payload: StatePayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(token: string, secret: string, now = Math.floor(Date.now() / 1000)): StatePayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: StatePayload;
  try { payload = JSON.parse(fromB64url(body).toString('utf8')); } catch { return null; }
  if (typeof payload?.exp !== 'number' || payload.exp < now) return null;
  return payload;
}
