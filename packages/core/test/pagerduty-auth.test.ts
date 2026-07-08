import { describe, it, expect } from 'vitest';
import { pdBaseUrl, pdHeaders, credsForConnection } from '../src/pagerduty/auth.js';
import { encryptSecret, keyFromBase64 } from '../src/crypto/secrets.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('pagerduty auth', () => {
  it('maps region to base url', () => {
    expect(pdBaseUrl('us')).toBe('https://api.pagerduty.com');
    expect(pdBaseUrl('eu')).toBe('https://api.eu.pagerduty.com');
  });

  it('builds the Token auth + versioned Accept headers', () => {
    const h = pdHeaders({ mode: 'api_keys', region: 'us', apiToken: 'abc123' });
    expect(h.Authorization).toBe('Token token=abc123');
    expect(h.Accept).toBe('application/vnd.pagerduty+json;version=2');
  });

  it('decrypts a single-token secret for a connection', () => {
    const ciphertext = encryptSecret('my-token', keyFromBase64(KEY));
    const creds = credsForConnection({ region: 'eu', secretCiphertext: ciphertext }, { SECRETS_KEY: KEY });
    expect(creds).toEqual({ mode: 'api_keys', region: 'eu', apiToken: 'my-token' });
  });
});
