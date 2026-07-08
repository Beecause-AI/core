import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

export type PubsubVerifyKey = CryptoKey | JWTVerifyGetKey;

/** Verifies a Pub/Sub push OIDC token: Google-signed RS256, audience + push-SA
 *  email match, email_verified. Returns true if authentic, false otherwise. */
export function makePubsubVerifier(opts: { audience: string; saEmail: string; getKey?: PubsubVerifyKey }) {
  const key: PubsubVerifyKey = opts.getKey ?? createRemoteJWKSet(new URL(GOOGLE_CERTS));
  return async function verify(token: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, key as CryptoKey, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: opts.audience,
        algorithms: ['RS256'],
      });
      return payload.email_verified === true && payload.email === opts.saEmail;
    } catch {
      return false;
    }
  };
}
