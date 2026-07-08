/**
 * Tests for POST /auth/register (OSS self-serve signup).
 *
 * Covers:
 *   (a) Happy path: 201 + __session cookie; new user can log in via localAuthProvider;
 *       new user is a member of the org.
 *   (b) Duplicate email → 409; original user's password hash unchanged.
 *   (c) Gate off (LOCAL_SIGNUP_ENABLED unset) → 403.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, activateOrg, getMembership, getUserByEmail } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { verifySessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { localAuthProvider } from '../src/auth/provider.js';
import { singleTenantResolver } from '../src/auth/tenant-resolver.js';
import { startTestDb, testConfig } from './helpers.js';
import type { Organization } from '@intellilabs/core';

const ORG_SLUG = 'oss-register-test';
const BASE_CONFIG = {
  ...testConfig,
  AUTH_BACKEND: 'local' as const,
  TENANT_MODE: 'single' as const,
  SINGLE_TENANT_SLUG: ORG_SLUG,
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let org: Organization;
let appEnabled: FastifyInstance;
let appDisabled: FastifyInstance;

function makeTenantResolver(db: typeof t.db, orgObj: Organization) {
  return singleTenantResolver(async () => orgObj);
}

beforeAll(async () => {
  t = await startTestDb();

  org = await createOrgWithOwner(t.db, { name: 'Register Test Org', slug: ORG_SLUG, userId: 'seed-owner' });
  await activateOrg(t.db, org.id);

  const tenantResolver = makeTenantResolver(t.db, org);
  const authProvider = localAuthProvider(t.db);

  // App with signup enabled
  appEnabled = await buildApp({
    db: t.db,
    store: t.store,
    config: { ...BASE_CONFIG, LOCAL_SIGNUP_ENABLED: 'true' },
    tenantResolver,
    authProvider,
  });

  // App with signup disabled (gate off)
  appDisabled = await buildApp({
    db: t.db,
    store: t.store,
    config: { ...BASE_CONFIG },
    tenantResolver,
    authProvider,
  });
});

afterAll(async () => {
  await appEnabled.close();
  await appDisabled.close();
  await t.stop();
});

describe('POST /auth/register', () => {
  describe('(a) happy path — LOCAL_SIGNUP_ENABLED=true', () => {
    const email = 'newuser@register-test.local';
    const password = 'correct-horse-battery-staple';
    const name = 'New User';

    it('returns 201 and sets a valid __session cookie', async () => {
      const res = await appEnabled.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, name },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ ok: true });

      // Cookie must be present and valid
      const setCookie = res.headers['set-cookie'] as string | string[];
      const raw = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie)
        .match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]!;
      const session = await verifySessionToken(decodeURIComponent(raw), testConfig.SESSION_SECRET);
      expect(session).toMatchObject({ email });
      // sub must be a UUID (server-generated, never client-supplied)
      expect(session!.sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('new user can authenticate via localAuthProvider with the registered password', async () => {
      const user = await getUserByEmail(t.db, email);
      expect(user).not.toBeNull();
      expect(user!.passwordHash).toMatch(/^scrypt\$/);

      const auth = localAuthProvider(t.db);
      const result = await auth.authenticate({ org, email, password });
      expect(result.email).toBe(email);
      expect(result.userId).toBe(user!.userId);
    });

    it('new user is a member of the org with role "user"', async () => {
      const user = await getUserByEmail(t.db, email);
      expect(user).not.toBeNull();
      const membership = await getMembership(t.db, org.id, user!.userId);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe('user');
    });
  });

  describe('(b) duplicate email → 409; original password hash unchanged', () => {
    const email = 'duplicate@register-test.local';
    const password = 'first-registration-password';

    it('first registration succeeds', async () => {
      const res = await appEnabled.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password },
      });
      expect(res.statusCode).toBe(201);
    });

    it('second registration with same email → 409', async () => {
      const res = await appEnabled.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'different-password-attempt' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'email already registered' });
    });

    it('original password hash is unchanged after dup attempt', async () => {
      // The original user must still be able to authenticate with their original password
      const auth = localAuthProvider(t.db);
      const result = await auth.authenticate({ org, email, password });
      expect(result.email).toBe(email);
    });
  });

  describe('(c) gate: LOCAL_SIGNUP_ENABLED unset → 403', () => {
    it('returns 403 with error "signup disabled"', async () => {
      const res = await appDisabled.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'gated@register-test.local', password: 'some-long-password' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'signup disabled' });
    });
  });

  describe('validation', () => {
    it('short password (< 8 chars) → 400', async () => {
      const res = await appEnabled.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'val@register-test.local', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('invalid email → 400', async () => {
      const res = await appEnabled.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', password: 'a-valid-password' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
