import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { GraphBuilderConfig } from './config.js';

const GOOGLE_JWKS = new URL('https://www.googleapis.com/oauth2/v3/certs');

/** Returns a verifier for inbound service-to-service calls (e.g. scheduler → graph-builder).
 *  If SERVICE_AUDIENCE is unset, auth is BYPASSED (local/dev/test) and always returns true.
 *  When set: verifies a Google-signed ID token with aud===SERVICE_AUDIENCE and optionally
 *  email===INVOKER_SA_EMAIL and email_verified. */
export function makeServiceVerifier(
  cfg: Pick<GraphBuilderConfig, 'SERVICE_AUDIENCE' | 'INVOKER_SA_EMAIL'>,
): (req: FastifyRequest) => Promise<boolean> {
  if (!cfg.SERVICE_AUDIENCE) {
    return async (_req: FastifyRequest): Promise<boolean> => true;
  }

  const aud = cfg.SERVICE_AUDIENCE;
  const jwks = createRemoteJWKSet(GOOGLE_JWKS);

  return async (req: FastifyRequest): Promise<boolean> => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: aud,
        algorithms: ['RS256'],
      });
      if (cfg.INVOKER_SA_EMAIL && payload['email'] !== cfg.INVOKER_SA_EMAIL) return false;
      if (payload['email_verified'] === false) return false;
      return true;
    } catch {
      return false;
    }
  };
}
