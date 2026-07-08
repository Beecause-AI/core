import { describe, expect, it } from 'vitest';
import { encryptSecret } from '@intellilabs/core';
import { credsForConnection, resolveAzureCredential } from '../src/azure/auth.js';

const KEY = Buffer.alloc(32, 7);
const cfg = { SECRETS_KEY: KEY.toString('base64'), AZURE_BASE_TENANT_ID: 'pt', AZURE_BASE_CLIENT_ID: 'pc', AZURE_BASE_FEDERATION_AUDIENCE: 'api://AzureADTokenExchange' };

describe('credsForConnection', () => {
  it('decodes a service_principal connection', () => {
    const conn = { mode: 'service_principal', tenantId: 't1', clientId: 'app1', secretCiphertext: encryptSecret('s3cr3t', KEY), federationSubject: null };
    expect(credsForConnection(conn, cfg)).toEqual({ mode: 'service_principal', tenantId: 't1', clientId: 'app1', clientSecret: 's3cr3t' });
  });

  it('decodes a workload_identity connection (no secret)', () => {
    const conn = { mode: 'workload_identity', tenantId: 't1', clientId: 'app1', secretCiphertext: '', federationSubject: 'subj-1' };
    expect(credsForConnection(conn, cfg)).toEqual({ mode: 'workload_identity', tenantId: 't1', clientId: 'app1', federationSubject: 'subj-1' });
  });

  it('throws on unknown mode', () => {
    expect(() => credsForConnection({ mode: 'x', tenantId: 't', clientId: 'c', secretCiphertext: '', federationSubject: null }, cfg)).toThrow(/unknown azure mode/i);
  });
});

describe('resolveAzureCredential', () => {
  it('service_principal builds a client-secret credential with the right args', async () => {
    let seen: any;
    const sentinel = { getToken: async () => ({ token: 't', expiresOnTimestamp: 0 }) };
    const cred = resolveAzureCredential(
      { mode: 'service_principal', tenantId: 't1', clientId: 'app1', clientSecret: 's' }, cfg,
      { makeSecretCredential: (tenantId, clientId, clientSecret) => { seen = { tenantId, clientId, clientSecret }; return sentinel; } },
    );
    expect(cred).toBe(sentinel);
    expect(seen).toEqual({ tenantId: 't1', clientId: 'app1', clientSecret: 's' });
  });

  it('workload_identity builds an assertion credential using platform federation', async () => {
    let seen: any;
    const sentinel = { getToken: async () => ({ token: 't', expiresOnTimestamp: 0 }) };
    const cred = resolveAzureCredential(
      { mode: 'workload_identity', tenantId: 't1', clientId: 'app1', federationSubject: 'subj' }, cfg,
      { makeAssertionCredential: (tenantId, clientId, getAssertion) => { seen = { tenantId, clientId, getAssertion }; return sentinel; }, getAssertion: async () => 'platform-jwt' },
    );
    expect(cred).toBe(sentinel);
    expect(seen.tenantId).toBe('t1');
    expect(seen.clientId).toBe('app1');
    expect(await seen.getAssertion()).toBe('platform-jwt');
  });

  it('workload_identity throws a clear error when platform base config is unset', () => {
    expect(() => resolveAzureCredential(
      { mode: 'workload_identity', tenantId: 't1', clientId: 'app1', federationSubject: 'subj' },
      { SECRETS_KEY: cfg.SECRETS_KEY },
    )).toThrow(/platform Azure base configuration/i);
  });
});
