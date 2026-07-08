import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import { getAllDocs } from '../store/query.js';
import { AlreadyExistsError } from '../ports/store.js';
import type { Organization, OrgMember, User } from '../store/types.js';

/** org_members composite PK (orgId, userId) → doc id. Matches project-members.ts /
 *  invitations.ts, which write the same id scheme. */
function memberId(orgId: string, userId: string): string {
  return `${orgId}_${userId}`;
}

/** Existing org docs predate the billing fields (fromDoc applies no column defaults). Fill them
 *  in on read so every consumer sees a complete, safe Organization. */
function withBillingDefaults(org: Organization): Organization {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = org as any;
  return {
    ...org,
    reportsEnabled: o.reportsEnabled ?? false,
    billingEnabled: o.billingEnabled ?? false,
    billingBand: o.billingBand ?? 'indie',
    stripeCustomerId: o.stripeCustomerId ?? null,
    stripeSubscriptionId: o.stripeSubscriptionId ?? null,
    subscriptionStatus: o.subscriptionStatus ?? null,
    aiSpendCapUsd: o.aiSpendCapUsd ?? null,
    creditBalanceCents: o.creditBalanceCents ?? 0,
  };
}

/** Postgres column defaults for organizations (schema.ts). Firestore has no column defaults,
 *  so creators must write them explicitly — otherwise consumers that gate on `status`/feature
 *  flags (resolveOrg 404s non-'active' orgs; findOrgsByEmail filters 'active') misbehave. */
function orgColumnDefaults() {
  return {
    plan: 'free',
    status: 'active' as 'active' | 'pending',
    ssoEnabled: false,
    betaTester: false,
    kgEnabled: false,
    hindsightEnabled: false,
    showCostUsd: false,
    reportsEnabled: false,
    debugEnabled: false,
    oidcClientSecret: null,
    idpTenantId: null,
    ssoProvider: null,
    pendingEmail: null,
    approvalPolicy: null,
    billingEnabled: false,
    billingBand: 'indie' as const,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    aiSpendCapUsd: null,
    creditBalanceCents: 0,
  };
}

export async function createOrgWithOwner(
  db: Db,
  input: { name: string; slug: string; userId: string },
): Promise<Organization> {
  const orgId = await db.runTransaction(async (tx) => {
    const oref = col(db, 'organizations').doc();
    tx.set(oref, toDoc(applyDefaults({ id: oref.id, name: input.name, slug: input.slug, ...orgColumnDefaults() }, oref.id)));
    const mref = col(db, 'org_members').doc(memberId(oref.id, input.userId));
    tx.set(
      mref,
      toDoc(applyDefaults({ orgId: oref.id, userId: input.userId, role: 'owner' }, mref.id)),
    );
    return oref.id;
  });
  const snap = await col(db, 'organizations').doc(orgId).get();
  return fromDoc<Organization>(snap);
}

export async function listOrgsForUser(db: Db, userId: string): Promise<Organization[]> {
  const members = await col(db, 'org_members').where('userId', '==', userId).get();
  const orgIds = [...new Set(members.map((d) => d.data()?.['orgId'] as string))];
  if (orgIds.length === 0) return [];
  const orgs = (await getAllDocs(db, 'organizations', orgIds)).map((s) => fromDoc<Organization>(s));
  // Postgres innerJoin had no explicit orderBy; preserve a stable order by id.
  return orgs.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getMembership(db: Db, orgId: string, userId: string): Promise<OrgMember | null> {
  const snap = await col(db, 'org_members').doc(memberId(orgId, userId)).get();
  return snap.exists ? fromDoc<OrgMember>(snap) : null;
}

/** Reserve a slug at signup: the realm + owner only exist once /complete activates it. */
export async function createPendingOrg(
  db: Db,
  input: { name: string; slug: string; email: string },
): Promise<Organization> {
  const ref = col(db, 'organizations').doc();
  const row = applyDefaults(
    { name: input.name, slug: input.slug, ...orgColumnDefaults(), status: 'pending' as const, pendingEmail: input.email },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<Organization>(await ref.get());
}

export async function deleteOrg(db: Db, orgId: string): Promise<void> {
  const ref = col(db, 'organizations').doc(orgId);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
}

export async function setOrgClientSecret(db: Db, orgId: string, secret: string): Promise<void> {
  await col(db, 'organizations').doc(orgId).update(toDoc({ oidcClientSecret: secret }));
}

/** Set the org's federated-SSO config (Identity Platform provider id + enabled flag). */
export async function setOrgSso(db: Db, orgId: string, sso: { ssoProvider: string | null; ssoEnabled: boolean }): Promise<void> {
  await col(db, 'organizations').doc(orgId).update(toDoc({ ssoProvider: sso.ssoProvider, ssoEnabled: sso.ssoEnabled }));
}

/** Persist the org's Identity Platform tenant id (set at provisioning; replaces the Keycloak realm). */
export async function setOrgIdpTenant(db: Db, orgId: string, tenantId: string): Promise<void> {
  await col(db, 'organizations').doc(orgId).update(toDoc({ idpTenantId: tenantId }));
}

export async function activateOrg(db: Db, orgId: string): Promise<void> {
  await col(db, 'organizations').doc(orgId).update(toDoc({ status: 'active', pendingEmail: null }));
}

/** Idempotent: re-running provisioning must not duplicate the owner row. */
export async function addOrgOwner(db: Db, orgId: string, userId: string): Promise<void> {
  const ref = col(db, 'org_members').doc(memberId(orgId, userId));
  await ref
    .create(toDoc(applyDefaults({ orgId, userId, role: 'owner' }, ref.id)))
    .catch((e: unknown) => {
      if (!(e instanceof AlreadyExistsError)) throw e; // onConflictDoNothing
    });
}

/** Idempotent: add a user to an org at the given role; a no-op if the member row already exists. */
export async function addOrgMember(
  db: Db,
  orgId: string,
  userId: string,
  role: 'owner' | 'manager' | 'user',
): Promise<void> {
  const ref = col(db, 'org_members').doc(memberId(orgId, userId));
  await ref
    .create(toDoc(applyDefaults({ orgId, userId, role }, ref.id)))
    .catch((e: unknown) => {
      if (!(e instanceof AlreadyExistsError)) throw e; // onConflictDoNothing
    });
}

export async function getOrgBySlug(db: Db, slug: string): Promise<Organization | null> {
  const snaps = await col(db, 'organizations').where('slug', '==', slug).limit(1).get();
  return snaps[0] ? withBillingDefaults(fromDoc<Organization>(snaps[0])) : null;
}

export async function getOrgById(db: Db, id: string): Promise<Organization | null> {
  const snap = await col(db, 'organizations').doc(id).get();
  return snap.exists ? withBillingDefaults(fromDoc<Organization>(snap)) : null;
}

export async function getOrgByStripeCustomerId(db: Db, customerId: string): Promise<Organization | null> {
  const snaps = await col(db, 'organizations').where('stripeCustomerId', '==', customerId).limit(1).get();
  const doc = snaps[0];
  return doc ? withBillingDefaults(fromDoc<Organization>(doc)) : null;
}

export type OrgMemberWithEmail = OrgMember & { email: string | null };

export async function listOrgMembers(db: Db, orgId: string): Promise<OrgMemberWithEmail[]> {
  const snaps = await col(db, 'org_members').where('orgId', '==', orgId).get();
  const members = snaps.map((d) => fromDoc<OrgMember>(d));
  if (members.length === 0) return [];

  // left-join users(email): getAll the user docs, stitch email (null when never logged in).
  const userIds = [...new Set(members.map((m) => m.userId))];
  const emailByUserId = new Map<string, string>();
  for (const s of await getAllDocs(db, 'users', userIds)) {
    emailByUserId.set(s.id, fromDoc<User>(s).email);
  }
  return members.map((m) => ({ ...m, email: emailByUserId.get(m.userId) ?? null }));
}

/** Set an org member's role; refuses to demote the last owner (returns false). */
export async function setOrgRole(db: Db, orgId: string, userId: string, role: 'owner' | 'manager' | 'user'): Promise<boolean> {
  const ref = col(db, 'org_members').doc(memberId(orgId, userId));
  return db.runTransaction(async (tx) => {
    // reads first
    const targetSnap = await tx.get(ref);
    if (role !== 'owner') {
      const owners = await tx.get(
        col(db, 'org_members').where('orgId', '==', orgId).where('role', '==', 'owner'),
      );
      if (owners.length === 1 && (owners[0]!.data()?.['userId'] as string) === userId) {
        return false; // last owner
      }
    }
    // writes: mirror the Postgres UPDATE … WHERE (no-op when the member doesn't exist).
    if (targetSnap.exists) tx.update(ref, toDoc({ role }));
    return true;
  });
}

export type OrgSummary = {
  id: string; name: string; slug: string; plan: string; status: string;
  betaTester: boolean; kgEnabled: boolean; debugEnabled: boolean; memberCount: number; createdAt: Date;
};

const ORG_LIST_LIMIT = 200;

/** Super console: every org with member counts. Secret columns
 *  (oidcClientSecret, pendingEmail) are deliberately not selected. */
export async function listAllOrgs(
  db: Db,
  opts: { q?: string; limit?: number } = {},
): Promise<{ orgs: OrgSummary[]; truncated: boolean }> {
  const limit = opts.limit ?? ORG_LIST_LIMIT;
  const needle = opts.q?.trim().toLowerCase();
  // Firestore has no ilike (case-insensitive substring); fetch ordered then filter in JS.
  const snaps = await col(db, 'organizations').orderBy('createdAt', 'desc').get();
  const all = snaps.map((d) => fromDoc<Organization>(d));
  const matched = needle
    ? all.filter((o) => o.name.toLowerCase().includes(needle) || o.slug.toLowerCase().includes(needle))
    : all;
  // sentinel slice → truncation flag without a count query
  const page = matched.slice(0, limit + 1);
  const truncated = page.length > limit;
  const shown = page.slice(0, limit);

  // member counts: one aggregation query per org (replaces count(...) + groupBy).
  const counts = await Promise.all(
    shown.map((o) =>
      col(db, 'org_members').where('orgId', '==', o.id).count(),
    ),
  );
  const orgs: OrgSummary[] = shown.map((o, i) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    plan: o.plan,
    status: o.status,
    betaTester: o.betaTester,
    kgEnabled: o.kgEnabled,
    debugEnabled: o.debugEnabled,
    memberCount: counts[i]!,
    createdAt: o.createdAt,
  }));
  return { orgs, truncated };
}

async function patchOrg(db: Db, orgId: string, patch: Partial<Organization>): Promise<Organization | null> {
  const ref = col(db, 'organizations').doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update(toDoc(patch));
  return fromDoc<Organization>(await ref.get());
}

export async function setOrgBetaTester(db: Db, orgId: string, betaTester: boolean): Promise<Organization | null> {
  return patchOrg(db, orgId, { betaTester });
}

export async function setOrgKgEnabled(db: Db, orgId: string, kgEnabled: boolean): Promise<Organization | null> {
  return patchOrg(db, orgId, { kgEnabled });
}

export async function setOrgHindsightEnabled(db: Db, orgId: string, enabled: boolean): Promise<Organization | null> {
  return patchOrg(db, orgId, { hindsightEnabled: enabled });
}

export async function setOrgShowCostUsd(db: Db, orgId: string, enabled: boolean): Promise<Organization | null> {
  return patchOrg(db, orgId, { showCostUsd: enabled });
}

export async function setOrgReportsEnabled(db: Db, orgId: string, enabled: boolean): Promise<Organization | null> {
  return patchOrg(db, orgId, { reportsEnabled: enabled });
}

export async function setOrgDebugEnabled(db: Db, orgId: string, debugEnabled: boolean): Promise<Organization | null> {
  return patchOrg(db, orgId, { debugEnabled });
}

export async function setOrgBillingState(
  db: Db,
  orgId: string,
  patch: Partial<Pick<Organization, 'billingEnabled' | 'billingBand' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'subscriptionStatus' | 'aiSpendCapUsd'>>,
): Promise<Organization | null> {
  return patchOrg(db, orgId, patch);
}
