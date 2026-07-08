import * as oidc from 'openid-client';

export type OidcClientConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scopes?: string;
  baseUrl: string;
};

export type AuthUrlParams = {
  state: string;
  nonce: string;
  codeChallenge: string;
};

export type OidcExchangeChecks = {
  pkceCodeVerifier: string;
  expectedState: string;
  expectedNonce: string;
};

/** Claims extracted from the id_token after a successful code exchange. */
export type OidcClaims = {
  sub: string;
  iss: string;
  email?: string;
  name?: string;
  /** Reflects the id_token `email_verified` claim. Undefined means the IdP omitted it. */
  email_verified?: boolean;
};

/**
 * Thin OIDC client wrapper.
 *
 * Holds a memoised Promise<Configuration> from openid-client v6 discovery().
 * The discovery() call is deferred to first use so boot-time does not block
 * on an external network request.
 *
 * Task 2 adds exchange() for the callback.
 */
export class OidcClient {
  private readonly cfg: OidcClientConfig;
  private configPromise: Promise<oidc.Configuration> | null = null;

  /**
   * The redirect_uri to register in authorization requests.
   * Uses OIDC_REDIRECT_URI when set, otherwise derives it from BASE_URL.
   */
  readonly redirectUri: string;

  /** Space-separated scope string (default: 'openid email profile'). */
  readonly scopes: string;

  constructor(cfg: OidcClientConfig) {
    this.cfg = cfg;
    this.redirectUri = cfg.redirectUri ?? new URL('/auth/oidc/callback', cfg.baseUrl).href;
    this.scopes = cfg.scopes ?? 'openid email profile';
  }

  /**
   * Lazily performs OIDC discovery and returns the memoised Configuration.
   * Subsequent calls return the same Promise (never re-discovers).
   */
  getConfig(): Promise<oidc.Configuration> {
    if (!this.configPromise) {
      this.configPromise = oidc.discovery(
        new URL(this.cfg.issuer),
        this.cfg.clientId,
        this.cfg.clientSecret,
      );
    }
    return this.configPromise;
  }

  /**
   * Builds the authorization URL to redirect the user-agent to.
   * Caller is responsible for generating random state/nonce/codeChallenge
   * via the library's CSPRNG helpers and carrying them in a txn cookie.
   */
  async authUrl(params: AuthUrlParams): Promise<URL> {
    const config = await this.getConfig();
    return oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: this.scopes,
      response_type: 'code',
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      state: params.state,
      nonce: params.nonce,
    });
  }

  /**
   * Exchanges the authorization code for tokens, validating state, PKCE, and
   * the id_token (signature, iss, aud == client_id, exp, nonce) via openid-client.
   *
   * Throws if any validation fails (state mismatch, bad nonce, invalid id_token, etc).
   * Returns the id_token claims relevant for user provisioning.
   *
   * SECURITY: state+PKCE+nonce are ENFORCED by authorizationCodeGrant — not merely
   * checked by us. The library throws on any mismatch before returning tokens.
   */
  async exchange(currentUrl: URL, checks: OidcExchangeChecks): Promise<OidcClaims> {
    const config = await this.getConfig();
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: checks.pkceCodeVerifier,
      expectedState: checks.expectedState,
      expectedNonce: checks.expectedNonce,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('oidc: id_token missing from token response');
    return {
      sub: claims.sub,
      iss: typeof claims['iss'] === 'string' ? claims['iss'] : this.cfg.issuer,
      email: typeof claims['email'] === 'string' ? claims['email'] : undefined,
      name: typeof claims['name'] === 'string' ? claims['name'] : undefined,
      email_verified: typeof claims['email_verified'] === 'boolean' ? claims['email_verified'] : undefined,
    };
  }
}
