import { describe, expect, it } from 'vitest';
import { encryptSecret } from '@intellilabs/core';
import { credsForConnection, mintToken, mintAmbientToken, GCP_READONLY_SCOPES } from '../src/gcp/auth.js';

const cfg = { SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') };

describe('credsForConnection', () => {
  it('decodes a sa_key connection', () => {
    const saJson = JSON.stringify({ client_email: 'a@x.iam', private_key: 'pk' });
    const conn = { mode: 'sa_key', secretCiphertext: encryptSecret(saJson, Buffer.alloc(32, 7)) };
    const creds = credsForConnection(conn, cfg);
    expect(creds).toEqual({ mode: 'sa_key', saJson });
  });

  it('decodes a wif connection', () => {
    const wifConfig = JSON.stringify({ type: 'external_account', audience: 'aud' });
    const conn = { mode: 'wif', secretCiphertext: encryptSecret(wifConfig, Buffer.alloc(32, 7)) };
    const creds = credsForConnection(conn, cfg);
    expect(creds).toEqual({ mode: 'wif', wifConfig });
  });

  it('throws on an unknown mode', () => {
    const conn = { mode: 'bogus', secretCiphertext: encryptSecret('x', Buffer.alloc(32, 7)) };
    expect(() => credsForConnection(conn, cfg)).toThrow(/unknown gcp mode/i);
  });
});

describe('mintToken (sa_key)', () => {
  it('mints via the injected JWT factory', async () => {
    const saJson = JSON.stringify({ client_email: 'a@x.iam', private_key: 'pk' });
    const token = await mintToken({ mode: 'sa_key', saJson }, GCP_READONLY_SCOPES, {
      makeJwt: (opts) => {
        expect(opts.email).toBe('a@x.iam');
        expect(opts.scopes).toEqual(GCP_READONLY_SCOPES);
        return { getAccessToken: async () => ({ token: 'tok-123' }) };
      },
    });
    expect(token).toBe('tok-123');
  });

  it('retries a transient node-fetch "Invalid response body" error, then succeeds', async () => {
    const saJson = JSON.stringify({ client_email: 'a@x.iam', private_key: 'pk' });
    const slept: number[] = [];
    let attempts = 0;
    const token = await mintToken({ mode: 'sa_key', saJson }, GCP_READONLY_SCOPES, {
      sleep: async (ms) => { slept.push(ms); },
      makeJwt: () => ({
        getAccessToken: async () => {
          attempts++;
          if (attempts < 3) throw new Error('Invalid response body while trying to fetch https://www.googleapis.com/oauth2/v4/token: Premature close');
          return { token: 'tok-after-retry' };
        },
      }),
    });
    expect(token).toBe('tok-after-retry');
    expect(attempts).toBe(3);
    expect(slept).toEqual([250, 750]); // backoff between the 3 attempts
  });

  it('does NOT retry a permanent credential rejection', async () => {
    const saJson = JSON.stringify({ client_email: 'a@x.iam', private_key: 'pk' });
    let attempts = 0;
    await expect(mintToken({ mode: 'sa_key', saJson }, GCP_READONLY_SCOPES, {
      sleep: async () => {},
      makeJwt: () => ({ getAccessToken: async () => { attempts++; throw new Error('invalid_grant: Invalid JWT Signature'); } }),
    })).rejects.toThrow(/invalid_grant/);
    expect(attempts).toBe(1);
  });

  it('gives up after exhausting retries on a persistent transient error', async () => {
    const saJson = JSON.stringify({ client_email: 'a@x.iam', private_key: 'pk' });
    let attempts = 0;
    await expect(mintToken({ mode: 'sa_key', saJson }, GCP_READONLY_SCOPES, {
      sleep: async () => {},
      makeJwt: () => ({ getAccessToken: async () => { attempts++; throw new Error('ECONNRESET'); } }),
    })).rejects.toThrow(/ECONNRESET/);
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe('mintAmbientToken', () => {
  it('mints from the injected ADC auth factory with the given scopes', async () => {
    let seenScopes: string[] | undefined;
    const token = await mintAmbientToken(['https://www.googleapis.com/auth/cloud-platform'], {
      makeAuth: (scopes) => {
        seenScopes = scopes;
        return { getAccessToken: async () => 'ambient-tok' };
      },
    });
    expect(token).toBe('ambient-tok');
    expect(seenScopes).toEqual(['https://www.googleapis.com/auth/cloud-platform']);
  });

  it('throws when no token is returned', async () => {
    await expect(
      mintAmbientToken(['s'], { makeAuth: () => ({ getAccessToken: async () => null }) }),
    ).rejects.toThrow(/ambient GCP access token/i);
  });
});
