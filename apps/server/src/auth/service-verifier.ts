import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = new URL('https://www.googleapis.com/oauth2/v3/certs');

/** Verifier for inbound service-to-service calls (engine-worker → server /int API).
 *  If SERVICE_AUDIENCE is unset, auth is BYPASSED (local/dev/test) → always true.
 *  When set: verifies a Google-signed ID token whose aud===SERVICE_AUDIENCE and
 *  (if INVOKER_SA_EMAIL set) email===INVOKER_SA_EMAIL and email_verified !== false. */
export function makeServiceVerifier(cfg: { SERVICE_AUDIENCE?: string; INVOKER_SA_EMAIL?: string }) {
  if (!cfg.SERVICE_AUDIENCE) {
    return async (_authHeader?: string): Promise<boolean> => true;
  }
  const aud = cfg.SERVICE_AUDIENCE;
  const jwks = createRemoteJWKSet(GOOGLE_JWKS);
  return async (authHeader?: string): Promise<boolean> => {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: aud,
        algorithms: ['RS256'],
      });
      if (cfg.INVOKER_SA_EMAIL && payload.email !== cfg.INVOKER_SA_EMAIL) return false;
      if (payload.email_verified === false) return false;
      return true;
    } catch {
      return false;
    }
  };
}
