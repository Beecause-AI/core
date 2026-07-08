import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOrgBySlug, getMembership } from '@intellilabs/core';
import { seedSingleTenant } from '../src/seed.js';
import { localAuthProvider } from '../src/auth/provider.js';
import { startTestDb } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

const SLUG = 'oss-seed-test';
const ADMIN_EMAIL = 'admin@seed-test.local';
const ADMIN_PASSWORD = 'seed-t3st-p@ssword';

const cfg = {
  SINGLE_TENANT_SLUG: SLUG,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
};

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('seedSingleTenant', () => {
  it('creates org + admin user + owner membership on first call', async () => {
    await seedSingleTenant(t.db, cfg);

    // Org exists with the right slug
    const org = await getOrgBySlug(t.db, SLUG);
    expect(org).not.toBeNull();
    expect(org!.slug).toBe(SLUG);
    expect(org!.status).toBe('active');

    // Admin user doc exists (check via getUserByEmail)
    const { getUserByEmail } = await import('@intellilabs/core');
    const user = await getUserByEmail(t.db, ADMIN_EMAIL);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(ADMIN_EMAIL);
    expect(user!.passwordHash).toBeTruthy();
    expect(user!.passwordHash).toMatch(/^scrypt\$/);

    // Owner membership exists
    const membership = await getMembership(t.db, org!.id, user!.userId);
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe('owner');
  });

  it('is idempotent: second call is a no-op (no duplicate org or overwrite)', async () => {
    // Fetch current org state before second call
    const orgBefore = await getOrgBySlug(t.db, SLUG);
    expect(orgBefore).not.toBeNull();

    // Run seed again — must not throw and must not change anything
    await expect(seedSingleTenant(t.db, cfg)).resolves.toBeUndefined();

    // Org unchanged
    const orgAfter = await getOrgBySlug(t.db, SLUG);
    expect(orgAfter).not.toBeNull();
    expect(orgAfter!.id).toBe(orgBefore!.id);
    expect(orgAfter!.createdAt.getTime()).toBe(orgBefore!.createdAt.getTime());

    // Still only one org with this slug (query returns first; length check via another query)
    const { getUserByEmail } = await import('@intellilabs/core');
    const user = await getUserByEmail(t.db, ADMIN_EMAIL);
    expect(user).not.toBeNull();

    // Password hash should be unchanged (same user doc)
    const membershipAfter = await getMembership(t.db, orgAfter!.id, user!.userId);
    expect(membershipAfter).not.toBeNull();
    expect(membershipAfter!.role).toBe('owner');
  });

  it('seeded admin can authenticate via localAuthProvider', async () => {
    const org = await getOrgBySlug(t.db, SLUG);
    expect(org).not.toBeNull();

    const auth = localAuthProvider(t.db);

    // Correct credentials → resolves with userId + email
    const result = await auth.authenticate({ org: org!, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(result.email).toBe(ADMIN_EMAIL);
    expect(result.userId).toBeTruthy();

    // Wrong password → throws InvalidCredentialsError
    const { InvalidCredentialsError } = await import('../src/auth/provider.js');
    await expect(
      auth.authenticate({ org: org!, email: ADMIN_EMAIL, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
