import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, FieldValue } from '../store/codec.js';
import type { Organization } from '../store/types.js';
import { chunk, getAllDocs } from '../store/query.js';

export interface UserRecord {
  id: string;
  userId: string;
  email: string;
  name?: string;
  passwordHash?: string;
  /** The OIDC `sub` claim that identifies this user at their IdP. */
  oidcSub?: string;
  /** The OIDC `iss` claim (issuer URL) paired with oidcSub. */
  oidcIss?: string;
}

/** Upsert the user's email (and optionally name/oidcSub/oidcIss) from ID-token claims; called on every successful login. */
export async function upsertUser(db: Db, input: { userId: string; email: string; name?: string; oidcSub?: string; oidcIss?: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  // doc id == userId (natural PK) → upsert is a merge-set.
  await col(db, 'users').doc(input.userId).set(
    {
      userId: input.userId,
      email,
      ...(input.name ? { name: input.name } : {}),
      ...(input.oidcSub ? { oidcSub: input.oidcSub } : {}),
      ...(input.oidcIss ? { oidcIss: input.oidcIss } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Link an existing user to an OIDC identity (iss + sub pair).
 * Called when a verified email matches an existing account that was created before
 * OIDC was configured — binds the IdP identity so future logins use sub lookup.
 */
export async function setUserOidc(db: Db, userId: string, iss: string, sub: string): Promise<void> {
  await col(db, 'users').doc(userId).set(
    { oidcIss: iss, oidcSub: sub, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * Look up a user by their OIDC issuer + subject (the stable identity pair).
 * Returns null when no user has been linked to that identity.
 */
export async function getUserByOidcSub(db: Db, iss: string, sub: string): Promise<UserRecord | null> {
  const snaps = await col(db, 'users')
    .where('oidcIss', '==', iss)
    .where('oidcSub', '==', sub)
    .get();
  if (snaps.length === 0) return null;
  return fromDoc<UserRecord>(snaps[0]!);
}

/** Look up a user by email. Returns the first matching user or null. */
export async function getUserByEmail(db: Db, email: string): Promise<UserRecord | null> {
  const target = email.trim().toLowerCase();
  const snaps = await col(db, 'users').where('email', '==', target).get();
  if (snaps.length === 0) return null;
  return fromDoc<UserRecord>(snaps[0]!);
}

/** Store a scrypt password hash for a user (local auth mode). */
export async function setUserPassword(db: Db, userId: string, passwordHash: string): Promise<void> {
  await col(db, 'users').doc(userId).set(
    { passwordHash, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** Orgs a (lowercased) email belongs to — powers the public workspaces lookup. */
export async function findOrgsByEmail(db: Db, email: string): Promise<Organization[]> {
  const target = email.trim().toLowerCase();
  // users(email) → userIds. One email may map to several userIds (multiple IdP accounts).
  const userSnaps = await col(db, 'users').where('email', '==', target).get();
  const userIds = userSnaps.map((d) => d.id);
  if (userIds.length === 0) return [];

  // org_members(userId in …) → distinct orgIds.
  const orgIds = new Set<string>();
  for (const ids of chunk(userIds, 30)) {
    const members = await col(db, 'org_members').where('userId', 'in', ids).get();
    for (const m of members) orgIds.add(m.data()?.orgId as string);
  }
  if (orgIds.size === 0) return [];

  // getAll organizations, keep active ones, dedupe (Set already), order by slug.
  const orgs = (await getAllDocs(db, 'organizations', [...orgIds]))
    .map((s) => fromDoc<Organization>(s))
    .filter((o) => o.status === 'active');
  return orgs.sort((a, b) => a.slug.localeCompare(b.slug));
}
