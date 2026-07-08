import { describe, it, expect } from 'vitest';
import { encryptSecret, keyFromBase64 } from '../crypto/secrets.js';
import { credsForConnection, authHeaders } from './auth.js';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const cfg = { SECRETS_KEY: KEY_B64 };
const enc = (s: string) => encryptSecret(s, keyFromBase64(KEY_B64));

describe('credsForConnection', () => {
  it('decodes an api_token connection', () => {
    expect(credsForConnection({ mode: 'api_token', secretCiphertext: enc('tok') }, cfg)).toEqual({ mode: 'api_token', apiToken: 'tok' });
  });
  it('decodes a global_key connection', () => {
    expect(credsForConnection({ mode: 'global_key', secretCiphertext: enc(JSON.stringify({ email: 'a@b.c', apiKey: 'k' })) }, cfg))
      .toEqual({ mode: 'global_key', email: 'a@b.c', apiKey: 'k' });
  });
  it('throws on unknown mode', () => {
    expect(() => credsForConnection({ mode: 'nope', secretCiphertext: enc('x') }, cfg)).toThrow(/unknown cloudflare mode/);
  });
});

describe('authHeaders', () => {
  it('api_token → Bearer', () => { expect(authHeaders({ mode: 'api_token', apiToken: 't' })).toEqual({ Authorization: 'Bearer t' }); });
  it('global_key → X-Auth-*', () => { expect(authHeaders({ mode: 'global_key', email: 'a@b.c', apiKey: 'k' })).toEqual({ 'X-Auth-Email': 'a@b.c', 'X-Auth-Key': 'k' }); });
});
