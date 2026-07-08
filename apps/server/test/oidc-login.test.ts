/**
 * Tests for GET /auth/oidc/login (Task 1 — OIDC Authorization Code + PKCE).
 *
 * openid-client's discovery() is bypassed via a test seam: we inject a
 * FakeOidcClient whose getConfig() returns a pre-built Configuration without
 * hitting any network. This avoids the ESM-hoisting fragility of vi.mock for
 * transitive dependencies.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as oidcLib from 'openid-client';
import { buildApp } from '../src/app.js';
import { OidcClient } from '../src/integrations/oidc/client.js';
import { verifyTxnToken, SESSION_COOKIE } from '../src/auth/session.js';
import { testConfig, startTestDb } from './helpers.js';
import type { AppConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Fake OidcClient — subclass that provides a pre-built Configuration so
// discovery() is never called. We construct the real Configuration directly
// from a static ServerMetadata object.
// ---------------------------------------------------------------------------

const FAKE_ISSUER = 'https://idp.example.com';
const FAKE_AUTH_ENDPOINT = 'https://idp.example.com/auth';
const FAKE_CLIENT_ID = 'test-client-id';
const FAKE_CLIENT_SECRET = 'test-client-secret';
const FAKE_REDIRECT_URI = new URL('/auth/oidc/callback', testConfig.BASE_URL).href;

class FakeOidcClient extends OidcClient {
  private fakeConfig: oidcLib.Configuration;

  constructor() {
    super({
      issuer: FAKE_ISSUER,
      clientId: FAKE_CLIENT_ID,
      clientSecret: FAKE_CLIENT_SECRET,
      baseUrl: testConfig.BASE_URL,
    });
    // Build the Configuration directly from static ServerMetadata.
    // This is the same data path discovery() would normally populate.
    this.fakeConfig = new oidcLib.Configuration(
      {
        issuer: FAKE_ISSUER,
        authorization_endpoint: FAKE_AUTH_ENDPOINT,
      },
      FAKE_CLIENT_ID,
    );
  }

  override getConfig(): Promise<oidcLib.Configuration> {
    return Promise.resolve(this.fakeConfig);
  }
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

const OIDC_CONFIG: AppConfig = {
  ...testConfig,
  AUTH_BACKEND: 'oidc',
  OIDC_ISSUER: FAKE_ISSUER,
  OIDC_CLIENT_ID: FAKE_CLIENT_ID,
  OIDC_CLIENT_SECRET: FAKE_CLIENT_SECRET,
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({
    db: t.db,
    store: t.store,
    config: OIDC_CONFIG,
    // Inject the fake client so no network discovery is attempted.
    oidcClient: new FakeOidcClient(),
  });
});

afterAll(async () => {
  await app?.close();
  await t?.stop();
});

// ---------------------------------------------------------------------------
// Helper: perform one login request and return the parsed redirect URL +
// raw Set-Cookie header string.
// ---------------------------------------------------------------------------
async function doLogin() {
  const res = await app.inject({ method: 'GET', url: '/auth/oidc/login' });
  const setCookieRaw = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
  const location = res.headers['location'] as string | undefined;
  return { res, cookieStr, location };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /auth/oidc/login', () => {
  it('redirects 302 to the IdP authorization endpoint', async () => {
    const { res } = await doLogin();
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain(FAKE_AUTH_ENDPOINT);
  });

  it('authorization URL contains response_type=code', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    expect(params.get('response_type')).toBe('code');
  });

  it('authorization URL contains the correct client_id', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    expect(params.get('client_id')).toBe(FAKE_CLIENT_ID);
  });

  it('authorization URL contains code_challenge and code_challenge_method=S256', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    const challenge = params.get('code_challenge');
    expect(challenge).toBeTruthy();
    // S256 challenges are base64url-encoded SHA-256 digests — non-empty URL-safe string
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(params.get('code_challenge_method')).toBe('S256');
  });

  it('authorization URL contains a non-empty state', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    expect(params.get('state')).toBeTruthy();
  });

  it('authorization URL contains a non-empty nonce', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    expect(params.get('nonce')).toBeTruthy();
  });

  it('authorization URL contains the correct redirect_uri', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    expect(params.get('redirect_uri')).toBe(FAKE_REDIRECT_URI);
  });

  it('authorization URL contains the openid email profile scopes', async () => {
    const { location } = await doLogin();
    const params = new URL(location!).searchParams;
    const scope = params.get('scope') ?? '';
    expect(scope).toContain('openid');
    expect(scope).toContain('email');
    expect(scope).toContain('profile');
  });

  it('sets a __session txn cookie that encodes the PKCE verifier and state+nonce', async () => {
    const { res, cookieStr } = await doLogin();
    expect(res.statusCode).toBe(302);
    expect(cookieStr).toBeTruthy();

    // Extract the __session value from Set-Cookie header
    const match = cookieStr.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    expect(match).toBeTruthy();
    const rawToken = decodeURIComponent(match![1]!);

    // Must verify as an OidcTxn
    const txn = await verifyTxnToken(rawToken, testConfig.SESSION_SECRET);
    expect(txn).toBeTruthy();
    expect(txn!.v).toBeTruthy(); // PKCE verifier — non-empty

    // state and nonce are packed as "${state}.${nonce}" in txn.s
    const parts = txn!.s.split('.');
    expect(parts[0]).toBeTruthy(); // state
    expect(parts[1]).toBeTruthy(); // nonce
  });

  it('state in the URL matches state packed into the txn cookie', async () => {
    const { location, cookieStr } = await doLogin();
    const urlState = new URL(location!).searchParams.get('state')!;

    const match = cookieStr.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    const rawToken = decodeURIComponent(match![1]!);
    const txn = await verifyTxnToken(rawToken, testConfig.SESSION_SECRET);
    const [stateFromCookie] = txn!.s.split('.');

    expect(urlState).toBe(stateFromCookie);
  });

  it('nonce in the URL matches nonce packed into the txn cookie', async () => {
    const { location, cookieStr } = await doLogin();
    const urlNonce = new URL(location!).searchParams.get('nonce')!;

    const match = cookieStr.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    const rawToken = decodeURIComponent(match![1]!);
    const txn = await verifyTxnToken(rawToken, testConfig.SESSION_SECRET);
    const [_state, nonceFromCookie] = txn!.s.split('.');

    expect(urlNonce).toBe(nonceFromCookie);
  });

  it('txn cookie has httpOnly and sameSite=lax attributes', async () => {
    const { cookieStr } = await doLogin();
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('samesite=lax');
  });
});
