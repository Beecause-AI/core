import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Direct public key (tests) or remote JWKS resolver (prod) — mirrors super-guard. */
export type IdpVerifyKey = CryptoKey | JWTVerifyGetKey;

export interface IdpClaims {
  sub: string;
  email?: string;
  name?: string;
  emailVerified: boolean;
  /** firebase.tenant — the Identity Platform tenant the user signed into. */
  tenant?: string;
}

export type IdpVerify = (idToken: string) => Promise<IdpClaims>;

// Firebase ID tokens are RS256 JWTs signed with Google's securetoken keys.
const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export function makeIdpVerifier(opts: { projectId: string; getKey?: IdpVerifyKey }): IdpVerify {
  const key: IdpVerifyKey = opts.getKey ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return async (idToken) => {
    // jwtVerify's key/getKey overloads share options; cast folds the union (as in super-guard).
    const { payload } = await jwtVerify(idToken, key as CryptoKey, {
      issuer: `https://securetoken.google.com/${opts.projectId}`,
      audience: opts.projectId,
      algorithms: ['RS256'],
    });
    const fb = (payload.firebase ?? {}) as { tenant?: string };
    return {
      sub: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      emailVerified: payload.email_verified === true,
      ...(fb.tenant ? { tenant: fb.tenant } : {}),
    };
  };
}
