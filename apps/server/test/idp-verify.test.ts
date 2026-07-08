import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { makeIdpVerifier } from '../src/integrations/idp/verify.js';

const PROJECT = 'test-project';
const ISS = `https://securetoken.google.com/${PROJECT}`;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;

function mint(claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT({ email: 'a@b.co', email_verified: true, name: 'Ada Lovelace', firebase: { tenant: 'tenant-acme', sign_in_provider: 'saml.okta' }, ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(opts.iss ?? ISS).setAudience(opts.aud ?? PROJECT).setSubject('idp-uid-1')
    .setIssuedAt('-2h').setExpirationTime(opts.exp ?? '1h').sign(keys.privateKey);
}

beforeAll(async () => { keys = await generateKeyPair('RS256'); });

describe('makeIdpVerifier', () => {
  it('verifies a valid token and returns sub/email/name/emailVerified/tenant', async () => {
    const verify = makeIdpVerifier({ projectId: PROJECT, getKey: keys.publicKey });
    const claims = await verify(await mint());
    expect(claims).toEqual({ sub: 'idp-uid-1', email: 'a@b.co', name: 'Ada Lovelace', emailVerified: true, tenant: 'tenant-acme' });
  });

  it('reports emailVerified=false when the claim is not strictly true', async () => {
    const verify = makeIdpVerifier({ projectId: PROJECT, getKey: keys.publicKey });
    expect((await verify(await mint({ email_verified: false }))).emailVerified).toBe(false);
  });

  it('throws on wrong issuer / audience / expiry / bad signature', async () => {
    const verify = makeIdpVerifier({ projectId: PROJECT, getKey: keys.publicKey });
    await expect(verify(await mint({}, { iss: 'https://securetoken.google.com/other' }))).rejects.toBeTruthy();
    await expect(verify(await mint({}, { aud: 'other' }))).rejects.toBeTruthy();
    await expect(verify(await mint({}, { exp: '-1h' }))).rejects.toBeTruthy();
    await expect(verify('not-a-jwt')).rejects.toBeTruthy();
  });
});
