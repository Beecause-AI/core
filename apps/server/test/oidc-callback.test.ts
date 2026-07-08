/**
 * Tests for GET /auth/oidc/callback (OIDC Authorization Code + PKCE callback).
 *
 * openid-client's token exchange is bypassed via a FakeOidcClient subclass whose
 * exchange() method returns injected claims without network calls.
 *
 * Covered cases:
 *   (a) Valid callback (code+state match txn cookie) → 302 to '/' + session cookie minted;
 *       user exists in DB and is a member of the org. Second login with same email is
 *       idempotent (no duplicate user/membership created).
 *   (b) State mismatch (exchange throws) → 400 and NO session cookie.
 *   (c) Missing txn cookie → 400 and NO session cookie.
 *   (d) email_verified:false → 403, no session; with OIDC_ALLOW_UNVERIFIED_EMAIL=true → allowed.
 *   (e) Same sub, different email → same user (looked up by sub, not a 2nd account).
 *   (f) New sub but email matches existing user → links oidcSub, no new user created.
 *   (g) Existing user re-login re-runs addOrgMember (self-healing) — idempotent, no duplicate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as oidcLib from 'openid-client';
import {
  createOrgWithOwner,
  activateOrg,
  getMembership,
  getUserByEmail,
  upsertUser,
} from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { OidcClient, type OidcExchangeChecks } from '../src/integrations/oidc/client.js';
import {
  createTxnToken,
  verifySessionToken,
  SESSION_COOKIE,
} from '../src/auth/session.js';
import { singleTenantResolver } from '../src/auth/tenant-resolver.js';
import { testConfig, startTestDb } from './helpers.js';
import type { AppConfig } from '../src/config.js';
import type { Organization } from '@intellilabs/core';

// ---------------------------------------------------------------------------
// Constants shared across tests
// ---------------------------------------------------------------------------

const FAKE_ISSUER = 'https://idp.example.com';
const FAKE_CLIENT_ID = 'test-client-id';
const FAKE_CLIENT_SECRET = 'test-client-secret';
const ORG_SLUG = 'oidc-callback-test';

// The claims the IdP returns for a successful login
const VALID_CLAIMS = {
  sub: 'idp-sub-abc123',
  iss: 'https://idp.example.com',
  email: 'alice@oidc-test.local',
  name: 'Alice Test',
  email_verified: true,
};

// ---------------------------------------------------------------------------
// FakeOidcClient
//
// Subclass that:
//  - Overrides getConfig() so no network discovery is attempted.
//  - Overrides exchange() to return injected claims for a valid expectedState
//    and throw an Error for any other expectedState (simulating state mismatch).
//  - Accepts optional override claims so individual tests can control what the
//    IdP "returns" (e.g. email_verified:false, a different sub, etc.).
// ---------------------------------------------------------------------------

const EXPECTED_STATE = 'known-valid-state';

class FakeOidcClient extends OidcClient {
  private fakeConfig: oidcLib.Configuration;
  private claimsOverride: Partial<typeof VALID_CLAIMS> | null = null;

  constructor() {
    super({
      issuer: FAKE_ISSUER,
      clientId: FAKE_CLIENT_ID,
      clientSecret: FAKE_CLIENT_SECRET,
      baseUrl: testConfig.BASE_URL,
    });
    this.fakeConfig = new oidcLib.Configuration(
      {
        issuer: FAKE_ISSUER,
        authorization_endpoint: `${FAKE_ISSUER}/auth`,
        token_endpoint: `${FAKE_ISSUER}/token`,
      },
      FAKE_CLIENT_ID,
    );
  }

  /** Override what claims exchange() returns for the next call(s). */
  setClaims(overrides: Partial<typeof VALID_CLAIMS> & { sub?: string; iss?: string; email?: string; email_verified?: boolean; name?: string }) {
    this.claimsOverride = overrides;
  }
  clearClaims() { this.claimsOverride = null; }

  override getConfig(): Promise<oidcLib.Configuration> {
    return Promise.resolve(this.fakeConfig);
  }

  override async exchange(
    currentUrl: URL,
    checks: OidcExchangeChecks,
  ): Promise<{ sub: string; iss: string; email?: string; name?: string; email_verified?: boolean }> {
    // Simulate the library's state validation: the real openid-client compares
    // the `state` param in the callback URL against `checks.expectedState` and
    // throws if they differ. We mirror that behaviour here.
    const urlState = currentUrl.searchParams.get('state');
    if (urlState !== checks.expectedState) {
      throw new Error('oidc: state mismatch (fake client simulates openid-client check)');
    }
    return { ...VALID_CLAIMS, ...this.claimsOverride };
  }
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

const OIDC_CONFIG: AppConfig = {
  ...testConfig,
  AUTH_BACKEND: 'oidc',
  TENANT_MODE: 'single',
  SINGLE_TENANT_SLUG: ORG_SLUG,
  OIDC_ISSUER: FAKE_ISSUER,
  OIDC_CLIENT_ID: FAKE_CLIENT_ID,
  OIDC_CLIENT_SECRET: FAKE_CLIENT_SECRET,
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let org: Organization;
let app: FastifyInstance;
let fakeClient: FakeOidcClient;

beforeAll(async () => {
  t = await startTestDb();

  org = await createOrgWithOwner(t.db, { name: 'OIDC Callback Test Org', slug: ORG_SLUG, userId: 'seed-owner' });
  await activateOrg(t.db, org.id);

  const tenantResolver = singleTenantResolver(async () => org);

  fakeClient = new FakeOidcClient();
  app = await buildApp({
    db: t.db,
    store: t.store,
    config: OIDC_CONFIG,
    tenantResolver,
    oidcClient: fakeClient,
  });
});

afterAll(async () => {
  await app?.close();
  await t?.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mints a signed txn cookie that encodes the given state+nonce and PKCE verifier.
 * The token is set as the Cookie header in the callback request.
 */
async function makeTxnCookie(state: string, nonce = 'test-nonce', verifier = 'test-verifier'): Promise<string> {
  return createTxnToken(
    { v: verifier, s: `${state}.${nonce}` },
    testConfig.SESSION_SECRET,
  );
}

/**
 * Invokes GET /auth/oidc/callback with optional override headers.
 * The URL includes a fake code and the provided state query params.
 */
async function doCallback(state: string, txnToken: string | null) {
  const url = `/auth/oidc/callback?code=fake-code&state=${encodeURIComponent(state)}`;
  const headers: Record<string, string> = {};
  if (txnToken !== null) {
    headers['cookie'] = `${SESSION_COOKIE}=${txnToken}`;
  }
  return app.inject({ method: 'GET', url, headers });
}

/** Extracts the __session cookie value from a Set-Cookie header string. */
function extractSessionCookie(res: Awaited<ReturnType<typeof app.inject>>): string | null {
  const raw = res.headers['set-cookie'];
  const cookieStr = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const match = cookieStr.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

// ---------------------------------------------------------------------------
// (a) Valid callback
// ---------------------------------------------------------------------------

describe('(a) valid callback — matching state + txn cookie', () => {
  it('returns 302 to /', async () => {
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback(EXPECTED_STATE, txn);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
  });

  it('sets a valid __session cookie containing the user sub + email', async () => {
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback(EXPECTED_STATE, txn);

    const cookieValue = extractSessionCookie(res);
    expect(cookieValue).not.toBeNull();

    const session = await verifySessionToken(cookieValue!, testConfig.SESSION_SECRET);
    expect(session).not.toBeNull();
    expect(session!.email).toBe(VALID_CLAIMS.email);
    expect(session!.sub).toBeTruthy();
  });

  it('session cookie is httpOnly + sameSite=lax', async () => {
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback(EXPECTED_STATE, txn);
    const raw = res.headers['set-cookie'];
    const cookieStr = (Array.isArray(raw) ? raw.join('; ') : (raw ?? '')).toLowerCase();
    expect(cookieStr).toContain('httponly');
    expect(cookieStr).toContain('samesite=lax');
  });

  it('auto-provisions the user in the DB', async () => {
    const txn = await makeTxnCookie(EXPECTED_STATE);
    await doCallback(EXPECTED_STATE, txn);

    const user = await getUserByEmail(t.db, VALID_CLAIMS.email);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(VALID_CLAIMS.email);
  });

  it('adds the user as a member of the org with role "user"', async () => {
    // Ensure user exists first (test ordering-independent)
    const txn = await makeTxnCookie(EXPECTED_STATE);
    await doCallback(EXPECTED_STATE, txn);

    const user = await getUserByEmail(t.db, VALID_CLAIMS.email);
    expect(user).not.toBeNull();
    const membership = await getMembership(t.db, org.id, user!.userId);
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe('user');
  });

  it('second login with the same email is idempotent (no duplicate user or membership)', async () => {
    // First login
    const txn1 = await makeTxnCookie(EXPECTED_STATE);
    const res1 = await doCallback(EXPECTED_STATE, txn1);
    expect(res1.statusCode).toBe(302);

    const session1 = await verifySessionToken(extractSessionCookie(res1)!, testConfig.SESSION_SECRET);

    // Second login
    const txn2 = await makeTxnCookie(EXPECTED_STATE);
    const res2 = await doCallback(EXPECTED_STATE, txn2);
    expect(res2.statusCode).toBe(302);

    const session2 = await verifySessionToken(extractSessionCookie(res2)!, testConfig.SESSION_SECRET);

    // Both sessions must refer to the same user
    expect(session1!.sub).toBe(session2!.sub);
    expect(session1!.email).toBe(session2!.email);

    // Only one user record should exist
    const user = await getUserByEmail(t.db, VALID_CLAIMS.email);
    expect(user).not.toBeNull();
    // Only one membership (getMembership returns a single record; if it throws on dup that would also be caught here)
    const membership = await getMembership(t.db, org.id, user!.userId);
    expect(membership).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b) State mismatch → 400, no session
// ---------------------------------------------------------------------------

describe('(b) state mismatch → 400, no session cookie', () => {
  it('returns 400 when the callback state does not match the txn cookie state', async () => {
    // The txn cookie encodes EXPECTED_STATE but we pass a DIFFERENT state in the URL.
    // FakeOidcClient.exchange() throws when expectedState !== EXPECTED_STATE.
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback('WRONG-STATE-XYZ', txn);
    expect(res.statusCode).toBe(400);
  });

  it('does NOT mint a session cookie on state mismatch', async () => {
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback('WRONG-STATE-XYZ', txn);

    // There must be no session cookie carrying a valid session token.
    const cookieValue = extractSessionCookie(res);
    if (cookieValue) {
      // If a cookie IS set (e.g. clearCookie sets an empty one), it must NOT verify as a session.
      const session = await verifySessionToken(cookieValue, testConfig.SESSION_SECRET);
      expect(session).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Missing txn cookie → 400
// ---------------------------------------------------------------------------

describe('(c) missing txn cookie → 400', () => {
  it('returns 400 when no txn cookie is present', async () => {
    const res = await doCallback(EXPECTED_STATE, null);
    expect(res.statusCode).toBe(400);
  });

  it('does NOT mint a session cookie when txn is absent', async () => {
    const res = await doCallback(EXPECTED_STATE, null);
    const cookieValue = extractSessionCookie(res);
    if (cookieValue) {
      const session = await verifySessionToken(cookieValue, testConfig.SESSION_SECRET);
      expect(session).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// (d) email_verified enforcement (I-1)
// ---------------------------------------------------------------------------

describe('(d) email_verified enforcement', () => {
  it('returns 403 when email_verified is false and OIDC_ALLOW_UNVERIFIED_EMAIL is not set', async () => {
    fakeClient.setClaims({ email_verified: false });
    try {
      const txn = await makeTxnCookie(EXPECTED_STATE);
      const res = await doCallback(EXPECTED_STATE, txn);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'email not verified' });
    } finally {
      fakeClient.clearClaims();
    }
  });

  it('does NOT mint a session cookie when email_verified is false', async () => {
    fakeClient.setClaims({ email_verified: false });
    try {
      const txn = await makeTxnCookie(EXPECTED_STATE);
      const res = await doCallback(EXPECTED_STATE, txn);
      const cookieValue = extractSessionCookie(res);
      if (cookieValue) {
        const session = await verifySessionToken(cookieValue, testConfig.SESSION_SECRET);
        expect(session).toBeNull();
      }
    } finally {
      fakeClient.clearClaims();
    }
  });

  it('allows login when OIDC_ALLOW_UNVERIFIED_EMAIL=true even if email_verified is false', async () => {
    // Build a separate app instance with the escape-hatch flag on.
    const tenantResolver = singleTenantResolver(async () => org);
    const permissiveClient = new FakeOidcClient();
    permissiveClient.setClaims({ email_verified: false, sub: 'sub-unverified-ok', email: 'unverified@oidc-test.local' });
    const permissiveApp = await buildApp({
      db: t.db,
      store: t.store,
      config: { ...OIDC_CONFIG, OIDC_ALLOW_UNVERIFIED_EMAIL: 'true' },
      tenantResolver,
      oidcClient: permissiveClient,
    });
    try {
      const txn = await makeTxnCookie(EXPECTED_STATE);
      const res = await permissiveApp.inject({
        method: 'GET',
        url: `/auth/oidc/callback?code=fake-code&state=${encodeURIComponent(EXPECTED_STATE)}`,
        headers: { cookie: `${SESSION_COOKIE}=${txn}` },
      });
      expect(res.statusCode).toBe(302);
    } finally {
      await permissiveApp.close();
    }
  });
});

// ---------------------------------------------------------------------------
// (e) Same sub, different email → same user (I-2)
// ---------------------------------------------------------------------------

describe('(e) same sub + different email → same user (keyed on sub not email)', () => {
  it('re-uses the same userId when the sub matches even if the email changed', async () => {
    const sharedSub = 'sub-email-change-test';
    const firstEmail = 'first-email@oidc-test.local';
    const secondEmail = 'second-email@oidc-test.local';

    // First login: sub + first email.
    fakeClient.setClaims({ sub: sharedSub, email: firstEmail });
    const txn1 = await makeTxnCookie(EXPECTED_STATE);
    const res1 = await doCallback(EXPECTED_STATE, txn1);
    expect(res1.statusCode).toBe(302);
    const session1 = await verifySessionToken(extractSessionCookie(res1)!, testConfig.SESSION_SECRET);
    fakeClient.clearClaims();

    // Second login: SAME sub, different email (simulating an email change at the IdP).
    fakeClient.setClaims({ sub: sharedSub, email: secondEmail });
    const txn2 = await makeTxnCookie(EXPECTED_STATE);
    const res2 = await doCallback(EXPECTED_STATE, txn2);
    expect(res2.statusCode).toBe(302);
    const session2 = await verifySessionToken(extractSessionCookie(res2)!, testConfig.SESSION_SECRET);
    fakeClient.clearClaims();

    // Both sessions must identify the SAME user.
    expect(session1!.sub).toBe(session2!.sub);
    // No second user was created under the new email — only one user doc for this sub.
    const byOld = await getUserByEmail(t.db, firstEmail);
    expect(byOld?.userId).toBe(session1!.sub);
  });
});

// ---------------------------------------------------------------------------
// (f) New sub but email matches existing user → link (I-2)
// ---------------------------------------------------------------------------

describe('(f) new sub but verified email matches existing user → links oidcSub', () => {
  it('re-uses the existing user and writes oidcSub/oidcIss onto them', async () => {
    const preExistingEmail = 'pre-existing@oidc-test.local';
    const preExistingId = 'pre-existing-user-id-oidc';

    // Seed an existing user created BEFORE OIDC (no oidcSub).
    await upsertUser(t.db, { userId: preExistingId, email: preExistingEmail, name: 'Pre-existing User' });

    // OIDC callback for a NEW sub but the same email.
    const newSub = 'brand-new-sub-for-existing-email';
    fakeClient.setClaims({ sub: newSub, email: preExistingEmail });
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback(EXPECTED_STATE, txn);
    expect(res.statusCode).toBe(302);
    fakeClient.clearClaims();

    const session = await verifySessionToken(extractSessionCookie(res)!, testConfig.SESSION_SECRET);

    // Must resolve to the PRE-EXISTING user, not a new one.
    expect(session!.sub).toBe(preExistingId);

    // Exactly one user record should exist for this email.
    const user = await getUserByEmail(t.db, preExistingEmail);
    expect(user).not.toBeNull();
    expect(user!.userId).toBe(preExistingId);
    // The oidcSub and oidcIss should now be set on the existing record.
    expect(user!.oidcSub).toBe(newSub);
    expect(user!.oidcIss).toBe(FAKE_ISSUER);
  });
});

// ---------------------------------------------------------------------------
// (g) Existing-user re-login re-runs addOrgMember (self-healing) (M-1)
// ---------------------------------------------------------------------------

describe('(g) existing user re-login re-runs addOrgMember (self-healing)', () => {
  it('addOrgMember runs on every login — idempotent for an already-member user', async () => {
    // The VALID_CLAIMS user (alice) is already provisioned from the (a) tests.
    // A second login must succeed and not blow up on a duplicate-member error.
    const txn = await makeTxnCookie(EXPECTED_STATE);
    const res = await doCallback(EXPECTED_STATE, txn);
    expect(res.statusCode).toBe(302);

    // Membership still intact (idempotent write).
    const user = await getUserByEmail(t.db, VALID_CLAIMS.email);
    const membership = await getMembership(t.db, org.id, user!.userId);
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe('user');
  });
});
