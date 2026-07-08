import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as oidcLib from 'openid-client';
import { getUserByEmail, getUserByOidcSub, upsertUser, setUserOidc, addOrgMember } from '@intellilabs/core';
import { OidcClient } from '../integrations/oidc/client.js';
import { SESSION_COOKIE, createTxnToken, txnFromCookieHeader, createSessionToken } from './session.js';
import { resolveOrg } from './org-context.js';

export type OidcAuthRoutesOpts = {
  /** Test seam: inject a pre-built OidcClient instead of constructing one from config. */
  oidcClient?: OidcClient;
};

/**
 * Registers OIDC Authorization Code + PKCE auth routes.
 * Only called when AUTH_BACKEND === 'oidc'.
 *
 * Task 1: GET /auth/oidc/login
 * Task 2: GET /auth/oidc/callback (not yet implemented)
 */
export async function oidcAuthRoutes(app: FastifyInstance, opts: OidcAuthRoutesOpts = {}) {
  const cfg = app.config;
  const secureCookies = cfg.NODE_ENV === 'production';

  // The OidcClient is constructed once per app instance (lazy discovery on first
  // request so boot does not block on an external network call).
  // In tests, a pre-built client can be injected to avoid network discovery.
  const oidcClient = opts.oidcClient ?? new OidcClient({
    issuer: cfg.OIDC_ISSUER!,
    clientId: cfg.OIDC_CLIENT_ID!,
    clientSecret: cfg.OIDC_CLIENT_SECRET!,
    redirectUri: cfg.OIDC_REDIRECT_URI,
    scopes: cfg.OIDC_SCOPES,
    baseUrl: cfg.BASE_URL,
  });

  /**
   * GET /auth/oidc/login
   *
   * 1. Generates PKCE verifier + S256 challenge (library CSPRNG).
   * 2. Generates state + nonce (library CSPRNG).
   * 3. Stashes verifier + state+nonce in a short-lived signed txn cookie.
   * 4. 302-redirects the browser to the IdP authorization endpoint.
   *
   * State and nonce are packed into OidcTxn.s as "${state}.${nonce}".
   * The callback (Task 2) unpacks them for validation.
   */
  app.get('/auth/oidc/login', async (req, reply) => {
    const verifier = oidcLib.randomPKCECodeVerifier();
    const challenge = await oidcLib.calculatePKCECodeChallenge(verifier);
    const state = oidcLib.randomState();
    const nonce = oidcLib.randomNonce();

    // Pack state+nonce into OidcTxn.s to avoid touching session.ts OidcTxn shape.
    const txnToken = await createTxnToken(
      { v: verifier, s: `${state}.${nonce}` },
      cfg.SESSION_SECRET,
    );

    // Short-lived txn cookie (10 min, matching createTxnToken's exp).
    // path:'/' keeps it host-only so it does not collide with the session cookie
    // that may be set with a COOKIE_DOMAIN.
    reply.setCookie(SESSION_COOKIE, txnToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: 600,
    });

    const authUrl = await oidcClient.authUrl({ state, nonce, codeChallenge: challenge });

    // Never log the full URL — it contains the state and nonce.
    req.log.info({ path: authUrl.pathname }, 'oidc: redirecting to authorization endpoint');
    return reply.redirect(authUrl.href, 302);
  });

  /**
   * GET /auth/oidc/callback
   *
   * 1. Reads the txn cookie (state + nonce + PKCE verifier).
   * 2. Exchanges the authorization code for tokens — openid-client validates:
   *    state match, PKCE, id_token signature/iss/aud/exp/nonce.
   * 3. Finds or auto-provisions the user in the single-tenant org.
   * 4. Clears the txn cookie, mints an app session, 302 to '/'.
   *
   * SECURITY:
   * - state/nonce/PKCE enforcement is DELEGATED to authorizationCodeGrant (not hand-rolled).
   * - Redirect target is the literal '/' — never a client-supplied URL param (no open redirect).
   * - Txn cookie is cleared on every callback, success or not (best-effort via clearCookie).
   * - Claims/tokens are never logged.
   */
  app.get('/auth/oidc/callback', { preHandler: resolveOrg }, async (req, reply) => {
    // Always attempt to clear the txn cookie so it does not persist on error paths.
    // Mirror password.ts clearCookie shape exactly (path only; no domain on the short-lived txn cookie).
    reply.clearCookie(SESSION_COOKIE, { path: '/' });

    // 1. Read and validate the signed txn cookie.
    const txn = await txnFromCookieHeader(req.headers.cookie, cfg.SESSION_SECRET);
    if (!txn) {
      return reply.code(400).send({ error: 'missing or invalid transaction cookie' });
    }

    // Unpack state+nonce (packed as "${state}.${nonce}" at login time).
    const dotIdx = txn.s.indexOf('.');
    if (dotIdx < 1) {
      return reply.code(400).send({ error: 'malformed transaction cookie' });
    }
    const expectedState = txn.s.slice(0, dotIdx);
    const expectedNonce = txn.s.slice(dotIdx + 1);
    const pkceCodeVerifier = txn.v;

    // 2. Reconstruct the full current URL (including ?code=&state= query params).
    // cfg.BASE_URL is the server's canonical origin; req.url is the path+query.
    // NEVER use a query param as the post-login redirect target.
    const currentUrl = new URL(req.url, cfg.BASE_URL);

    let claims: { sub: string; iss: string; email?: string; name?: string; email_verified?: boolean };
    try {
      claims = await oidcClient.exchange(currentUrl, {
        pkceCodeVerifier,
        expectedState,
        expectedNonce,
      });
    } catch (err) {
      // Do not leak internal error detail to the client; log at info level (no token/secret in err).
      req.log.info({ msg: 'oidc callback validation failed', err: String(err) }, 'oidc: exchange failed');
      return reply.code(400).send({ error: 'authentication failed' });
    }

    // I-1: Require email_verified unless the operator has opted out.
    // Default is secure: reject logins where the IdP has not verified the email address.
    if (claims.email_verified !== true && cfg.OIDC_ALLOW_UNVERIFIED_EMAIL !== 'true') {
      req.log.info({ sub: claims.sub }, 'oidc: rejecting login — email not verified');
      return reply.code(403).send({ error: 'email not verified' });
    }

    // 3. email is required — even when keying on sub we need email for the session token.
    if (!claims.email) {
      return reply.code(400).send({ error: 'oidc: id_token missing email claim' });
    }
    const { sub, iss, email, name } = claims;

    // I-2: Key identity on (iss, sub) — not email — to survive email changes at the IdP.
    // Provisioning order:
    //   1. Sub lookup (stable key): existing linked user → fast path.
    //   2. Email lookup (verified by I-1): link the oidcSub to the existing account.
    //   3. Brand-new user: create + link.
    let userId: string;
    const byOidc = await getUserByOidcSub(app.db, iss, sub);
    if (byOidc) {
      // Fast path: already linked.
      userId = byOidc.userId;
    } else {
      const byEmail = await getUserByEmail(app.db, email);
      if (byEmail) {
        // Link the OIDC identity to the existing email-keyed account.
        userId = byEmail.userId;
        await setUserOidc(app.db, userId, iss, sub);
      } else {
        // Brand-new user: create the record including the OIDC identity.
        userId = randomUUID();
        await upsertUser(app.db, { userId, email, name, oidcSub: sub, oidcIss: iss });
      }
    }

    // M-1: addOrgMember is idempotent — run on EVERY successful login (not only new users)
    // so that an existing user who was removed gets re-added, and a new user gets added.
    await addOrgMember(app.db, req.org!.id, userId, 'user');

    // 5. Mint the app session — same cookie shape as password.ts and register.ts.
    const session = await createSessionToken({ sub: userId, email, name }, cfg.SESSION_SECRET);
    reply.setCookie(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: 7 * 24 * 3600,
      ...(cfg.COOKIE_DOMAIN ? { domain: cfg.COOKIE_DOMAIN } : {}),
    });

    // Redirect to '/': the target is server-controlled — never from a client param.
    return reply.redirect('/', 302);
  });
}
