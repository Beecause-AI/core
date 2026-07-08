import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  createTxnToken,
  verifyTxnToken,
  sessionFromCookieHeader,
  txnFromCookieHeader,
} from '../src/auth/session.js';

const secret = 'a'.repeat(32);

describe('session tokens', () => {
  it('round-trips a user', async () => {
    const token = await createSessionToken({ sub: 'u1', email: 'a@b.c', name: 'A' }, secret);
    expect(await verifySessionToken(token, secret)).toEqual({ sub: 'u1', email: 'a@b.c', name: 'A' });
  });

  it('rejects a forged token', async () => {
    const token = await createSessionToken({ sub: 'u1' }, secret);
    expect(await verifySessionToken(token, 'b'.repeat(32))).toBeNull();
    expect(await verifySessionToken(token + 'x', secret)).toBeNull();
  });
});

describe('oidc txn tokens', () => {
  it('round-trips a txn', async () => {
    const token = await createTxnToken({ v: 'verifier', s: 'state' }, secret);
    expect(await verifyTxnToken(token, secret)).toEqual({ v: 'verifier', s: 'state' });
  });

  it('keeps kinds segregated', async () => {
    const session = await createSessionToken({ sub: 'u1' }, secret);
    const txn = await createTxnToken({ v: 'v', s: 's' }, secret);
    expect(await verifySessionToken(txn, secret)).toBeNull();
    expect(await verifyTxnToken(session, secret)).toBeNull();
  });
});

// In prod the host-only txn cookie and the Domain-wide session cookie BOTH live
// under the __session name (Firebase Hosting forwards only that name), so requests
// mid-login carry duplicates — readers must pick the value of the right kind.
describe('duplicate __session cookies (host-only txn + domain session)', () => {
  it('sessionFromCookieHeader picks the session value regardless of order', async () => {
    const session = await createSessionToken({ sub: 'u1' }, secret);
    const txn = await createTxnToken({ v: 'v', s: 's' }, secret);
    for (const header of [`__session=${txn}; __session=${session}`, `__session=${session}; __session=${txn}`]) {
      expect((await sessionFromCookieHeader(header, secret))?.sub).toBe('u1');
    }
  });

  it('txnFromCookieHeader picks the txn value regardless of order', async () => {
    const session = await createSessionToken({ sub: 'u1' }, secret);
    const txn = await createTxnToken({ v: 'verifier', s: 'state', o: 'acme' }, secret);
    for (const header of [`__session=${txn}; __session=${session}`, `__session=${session}; __session=${txn}`]) {
      expect((await txnFromCookieHeader(header, secret))?.o).toBe('acme');
    }
  });

  it('both return null for an absent/foreign header', async () => {
    expect(await sessionFromCookieHeader(undefined, secret)).toBeNull();
    expect(await txnFromCookieHeader('other=1', secret)).toBeNull();
  });
});

describe('session id_token passthrough (RP-initiated logout)', () => {
  it('round-trips idt so logout can send id_token_hint (skips the KC confirm page)', async () => {
    const token = await createSessionToken({ sub: 'u1', email: 'a@b.c', idt: 'header.payload.sig' }, secret);
    const user = await verifySessionToken(token, secret);
    expect(user?.idt).toBe('header.payload.sig');
  });

  it('omits idt when absent (auto-provisioned sessions have no KC SSO)', async () => {
    const token = await createSessionToken({ sub: 'u1' }, secret);
    const user = await verifySessionToken(token, secret);
    expect(user?.idt).toBeUndefined();
  });
});
