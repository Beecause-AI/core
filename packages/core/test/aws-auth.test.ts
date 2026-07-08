import { describe, expect, it } from 'vitest';
import { encryptSecret } from '@intellilabs/core';
import { credsForConnection, resolveAwsCreds, accountFromRoleArn } from '../src/aws/auth.js';

const KEY = Buffer.alloc(32, 7);
const cfg = { SECRETS_KEY: KEY.toString('base64'), AWS_BASE_ACCESS_KEY_ID: 'AKIA_BASE', AWS_BASE_SECRET_ACCESS_KEY: 'base-secret', AWS_BASE_REGION: 'us-east-1' };

describe('accountFromRoleArn', () => {
  it('extracts the 12-digit account id', () => {
    expect(accountFromRoleArn('arn:aws:iam::111122223333:role/beecause-ro')).toBe('111122223333');
    expect(accountFromRoleArn('not-an-arn')).toBeNull();
  });
});

describe('credsForConnection', () => {
  it('decodes an access_key connection', () => {
    const blob = JSON.stringify({ accessKeyId: 'AKIA1', secretAccessKey: 's3cr3t' });
    const conn = { mode: 'access_key', secretCiphertext: encryptSecret(blob, KEY), roleArn: null, externalId: null };
    expect(credsForConnection(conn, cfg)).toEqual({ mode: 'access_key', accessKeyId: 'AKIA1', secretAccessKey: 's3cr3t' });
  });

  it('decodes an assume_role connection (no secret)', () => {
    const conn = { mode: 'assume_role', secretCiphertext: '', roleArn: 'arn:aws:iam::111122223333:role/ro', externalId: 'ext-1' };
    expect(credsForConnection(conn, cfg)).toEqual({ mode: 'assume_role', roleArn: 'arn:aws:iam::111122223333:role/ro', externalId: 'ext-1' });
  });

  it('throws on unknown mode', () => {
    expect(() => credsForConnection({ mode: 'x', secretCiphertext: '', roleArn: null, externalId: null }, cfg)).toThrow(/unknown aws mode/i);
  });
});

describe('resolveAwsCreds', () => {
  it('passes through access_key creds unchanged', async () => {
    const out = await resolveAwsCreds({ mode: 'access_key', accessKeyId: 'AKIA1', secretAccessKey: 's' }, 'eu-west-1', cfg);
    expect(out).toEqual({ accessKeyId: 'AKIA1', secretAccessKey: 's' });
  });

  it('assume_role calls the injected assumeRole with base creds + externalId', async () => {
    let seen: any;
    const out = await resolveAwsCreds(
      { mode: 'assume_role', roleArn: 'arn:aws:iam::111122223333:role/ro', externalId: 'ext-1' },
      'eu-west-1', cfg,
      { assumeRole: async (p) => { seen = p; return { accessKeyId: 'ASIA', secretAccessKey: 'tmp', sessionToken: 'tok' }; } },
    );
    expect(out).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'tmp', sessionToken: 'tok' });
    expect(seen).toMatchObject({
      roleArn: 'arn:aws:iam::111122223333:role/ro', externalId: 'ext-1', region: 'eu-west-1',
      base: { accessKeyId: 'AKIA_BASE', secretAccessKey: 'base-secret', region: 'us-east-1' },
    });
  });

  it('assume_role throws a clear error when base creds are unset', async () => {
    await expect(resolveAwsCreds(
      { mode: 'assume_role', roleArn: 'arn:aws:iam::1:role/r', externalId: 'e' }, 'us-east-1',
      { SECRETS_KEY: cfg.SECRETS_KEY },
    )).rejects.toThrow(/platform AWS base credentials/i);
  });
});
