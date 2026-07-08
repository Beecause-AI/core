import { createOrgWithOwner, getOrgBySlug, upsertUser, setUserPassword, addOrgOwner, hashPassword } from '@intellilabs/core';
import type { Db } from '@intellilabs/core';
import type { AppConfig } from './config.js';

/**
 * Idempotent single-tenant install-time seed.
 *
 * Creates one org (status=active), one admin user with a hashed password,
 * and an org_members owner row linking them.
 *
 * Safe to call on every boot: if the org already exists, returns immediately.
 * Passwords and hashes are NEVER logged.
 */
export async function seedSingleTenant(
  db: Db,
  cfg: Pick<AppConfig, 'SINGLE_TENANT_SLUG' | 'ADMIN_EMAIL' | 'ADMIN_PASSWORD'>,
  logger?: { info(data: Record<string, unknown>, msg: string): void },
): Promise<void> {
  const slug = cfg.SINGLE_TENANT_SLUG ?? 'default';

  // Idempotency check: if the org already exists, do nothing.
  const existing = await getOrgBySlug(db, slug);
  if (existing) return;

  const adminEmail = cfg.ADMIN_EMAIL!;
  const adminPassword = cfg.ADMIN_PASSWORD!;

  // Stable, deterministic userId so re-runs are idempotent even if Firestore has
  // partial state (e.g. the user was written but the org transaction failed).
  const adminUserId = `seed-admin-${slug}`;

  // 1. Create the org with the admin as owner (atomic transaction in createOrgWithOwner).
  //    createOrgWithOwner uses orgColumnDefaults() which sets status='active'.
  const org = await createOrgWithOwner(db, { name: slug, slug, userId: adminUserId });

  // 2. Write the admin user record (email; no IdP tenant needed for local auth).
  await upsertUser(db, { userId: adminUserId, email: adminEmail });

  // 3. Set the scrypt password hash. NEVER log the password or hash.
  await setUserPassword(db, adminUserId, hashPassword(adminPassword));

  // 4. Ensure the owner membership exists (createOrgWithOwner already wrote it,
  //    but addOrgOwner is idempotent and guards against partial-failure re-runs).
  await addOrgOwner(db, org.id, adminUserId);

  logger?.info({ orgSlug: slug, adminEmail }, `seeded single-tenant org ${slug} with admin ${adminEmail}`);
}
