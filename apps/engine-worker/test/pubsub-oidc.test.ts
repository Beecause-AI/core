import { describe, expect, it, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { makePubsubVerifier } from '../src/auth/pubsub-oidc.js';

let priv: CryptoKey; let pub: CryptoKey;
beforeAll(async () => { const kp = await generateKeyPair('RS256'); priv = kp.privateKey; pub = kp.publicKey; });

async function token(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience('https://srv/api/internal/run-turn')
    .setIssuedAt().setExpirationTime('5m').sign(priv);
}
const verify = () => makePubsubVerifier({ audience: 'https://srv/api/internal/run-turn', saEmail: 'push@proj.iam.gserviceaccount.com', getKey: pub });

describe('makePubsubVerifier', () => {
  it('accepts a token from the right SA + audience', async () => {
    await expect(verify()(await token({ email: 'push@proj.iam.gserviceaccount.com' }))).resolves.toBe(true);
  });
  it('rejects a wrong audience', async () => {
    const t = await new SignJWT({ email: 'push@proj.iam.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
      .setAudience('https://evil/').setIssuedAt().setExpirationTime('5m').sign(priv);
    await expect(verify()(t)).resolves.toBe(false);
  });
  it('rejects a wrong service-account email', async () => {
    await expect(verify()(await token({ email: 'attacker@proj.iam.gserviceaccount.com' }))).resolves.toBe(false);
  });
  it('rejects email_verified=false', async () => {
    const t = await new SignJWT({ email: 'push@proj.iam.gserviceaccount.com', email_verified: false })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
      .setAudience('https://srv/api/internal/run-turn').setIssuedAt().setExpirationTime('5m').sign(priv);
    await expect(verify()(t)).resolves.toBe(false);
  });
  it('rejects garbage', async () => {
    await expect(verify()('not-a-jwt')).resolves.toBe(false);
  });
  it('rejects an expired token', async () => {
    const t = await new SignJWT({ email: 'push@proj.iam.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
      .setAudience('https://srv/api/internal/run-turn')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime('-1m').sign(priv);
    await expect(verify()(t)).resolves.toBe(false);
  });
  it('rejects a token signed with a different key', async () => {
    const other = await generateKeyPair('RS256');
    const t = await new SignJWT({ email: 'push@proj.iam.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
      .setAudience('https://srv/api/internal/run-turn').setIssuedAt().setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verify()(t)).resolves.toBe(false);
  });
  it('rejects a foreign issuer', async () => {
    const t = await new SignJWT({ email: 'push@proj.iam.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.evil.com')
      .setAudience('https://srv/api/internal/run-turn').setIssuedAt().setExpirationTime('5m').sign(priv);
    await expect(verify()(t)).resolves.toBe(false);
  });
  it('accepts aud as an array containing the correct value', async () => {
    const t = await new SignJWT({ email: 'push@proj.iam.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
      .setAudience(['https://other/', 'https://srv/api/internal/run-turn'])
      .setIssuedAt().setExpirationTime('5m').sign(priv);
    await expect(verify()(t)).resolves.toBe(true);
  });
});
