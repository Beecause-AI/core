import { describe, expect, it } from 'vitest';
import { encryptSecret } from '@intellilabs/core';
import { credsForConnection, siteBaseUrl, ddHeaders } from '../src/datadog/auth.js';

const KEY = Buffer.alloc(32, 7);
const cfg = { SECRETS_KEY: KEY.toString('base64') };

describe('siteBaseUrl', () => {
  it('maps known sites to their base URLs', () => {
    expect(siteBaseUrl('eu')).toBe('https://api.datadoghq.eu');
    expect(siteBaseUrl('us1')).toBe('https://api.datadoghq.com');
    expect(siteBaseUrl('us3')).toBe('https://api.us3.datadoghq.com');
    expect(siteBaseUrl('us5')).toBe('https://api.us5.datadoghq.com');
    expect(siteBaseUrl('ap1')).toBe('https://api.ap1.datadoghq.com');
    expect(siteBaseUrl('us1-fed')).toBe('https://api.ddog-gov.com');
  });

  it('falls back to us1 for unknown sites', () => {
    expect(siteBaseUrl('bogus')).toBe('https://api.datadoghq.com');
    expect(siteBaseUrl('')).toBe('https://api.datadoghq.com');
  });
});

describe('credsForConnection', () => {
  it('round-trips api+app keys through encrypt/decrypt', () => {
    const secretCiphertext = encryptSecret(JSON.stringify({ apiKey: 'a', appKey: 'b' }), KEY);
    const creds = credsForConnection({ site: 'us3', secretCiphertext }, cfg);
    expect(creds).toEqual({ mode: 'api_keys', apiKey: 'a', appKey: 'b', site: 'us3' });
  });

  it('defaults site to us1 when site is empty', () => {
    const secretCiphertext = encryptSecret(JSON.stringify({ apiKey: 'x', appKey: 'y' }), KEY);
    const creds = credsForConnection({ site: '', secretCiphertext }, cfg);
    expect(creds.site).toBe('us1');
  });
});

describe('ddHeaders', () => {
  it('sets DD-API-KEY and DD-APPLICATION-KEY headers', () => {
    const creds = { mode: 'api_keys' as const, apiKey: 'key1', appKey: 'app1', site: 'us1' as const };
    const headers = ddHeaders(creds);
    expect(headers['DD-API-KEY']).toBe('key1');
    expect(headers['DD-APPLICATION-KEY']).toBe('app1');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
