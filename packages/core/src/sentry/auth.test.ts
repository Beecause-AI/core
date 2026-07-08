import { describe, it, expect } from 'vitest';
import { encryptSecret, keyFromBase64 } from '../crypto/secrets.js';
import { credsForConnection, authHeaders } from './auth.js';

const key = keyFromBase64(Buffer.alloc(32, 7).toString('base64'));
const cfg = { SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') };

describe('sentry/auth', () => {
  it('decrypts an auth_token connection secret', () => {
    const conn = { mode: 'auth_token', secretCiphertext: encryptSecret('sntrys_abc123', key) };
    expect(credsForConnection(conn, cfg)).toEqual({ mode: 'auth_token', token: 'sntrys_abc123' });
  });

  it('throws on an unknown mode', () => {
    const conn = { mode: 'oauth', secretCiphertext: encryptSecret('x', key) };
    expect(() => credsForConnection(conn, cfg)).toThrow(/unknown sentry mode/);
  });

  it('builds a Bearer Authorization header', () => {
    expect(authHeaders({ mode: 'auth_token', token: 'tok' })).toEqual({ Authorization: 'Bearer tok' });
  });
});
