import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { GatewayConfig } from './config.js';

const GOOGLE_JWKS = new URL('https://www.googleapis.com/oauth2/v3/certs');

/** Returns a verifier for inbound service-to-service calls. If GATEWAY_AUDIENCE is unset,
 *  auth is BYPASSED (local/dev/test) and the verifier always returns true. When set, it
 *  verifies a Google-signed ID token whose aud===GATEWAY_AUDIENCE and (if INVOKER_SA_EMAIL
 *  set) email===INVOKER_SA_EMAIL and email_verified. */
export function makeGatewayVerifier(
  cfg: Pick<GatewayConfig, 'GATEWAY_AUDIENCE' | 'INVOKER_SA_EMAIL'>,
) {
  if (!cfg.GATEWAY_AUDIENCE) {
    return async (_authHeader: string | undefined): Promise<boolean> => true;
  }

  const aud = cfg.GATEWAY_AUDIENCE;
  const jwks = createRemoteJWKSet(GOOGLE_JWKS);

  return async (authHeader: string | undefined): Promise<boolean> => {
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
