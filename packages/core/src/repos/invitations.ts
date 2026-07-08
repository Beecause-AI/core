import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import { AlreadyExistsError } from '../ports/store.js';
import type { OrgInvitation } from '../store/types.js';

export type InviteRole = 'manager' | 'user';

/**
 * Create a pending invitation. Postgres enforced "at most one PENDING invite per
 * (org, email)" via a partial unique index; Firestore has no such constraint, so we
 * emulate it with a pre-write existence check that throws a unique-violation error
 * (`code === '23505'`) — callers surface that as "already invited". The check is
 * non-atomic (a true concurrent double-create could slip through), which is acceptable
 * here since invites are admin-initiated and rare.
 */
export async function createInvitation(
  db: Db,
  input: { orgId: string; email: string; role: InviteRole; invitedBy: string; expiresAt: Date },
): Promise<OrgInvitation> {
  const email = input.email.trim().toLowerCase();
  const dup = await col(db, 'org_invitations')
    .where('orgId', '==', input.orgId)
    .where('email', '==', email)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (dup.length > 0) {
    throw Object.assign(new Error('duplicate'), { code: '23505' });
  }
  const ref = col(db, 'org_invitations').doc();
  const row = applyDefaults(
    { orgId: input.orgId, email, role: input.role, invitedBy: input.invitedBy, status: 'pending', expiresAt: input.expiresAt },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<OrgInvitation>(await ref.get());
}

export async function listPendingInvitations(db: Db, orgId: string): Promise<OrgInvitation[]> {
  const snaps = await col(db, 'org_invitations')
    .where('orgId', '==', orgId)
    .where('status', '==', 'pending')
    .get();
  return snaps
    .map((d) => fromDoc<OrgInvitation>(d))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function getInvitation(db: Db, id: string): Promise<OrgInvitation | null> {
  const snap = await col(db, 'org_invitations').doc(id).get();
  return snap.exists ? fromDoc<OrgInvitation>(snap) : null;
}

/** Revoke a PENDING invitation scoped to the org; false if there is none. */
export async function revokeInvitation(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'org_invitations').doc(id);
  const snap = await ref.get();
  if (
    !snap.exists ||
    (snap.data()?.['orgId'] as string) !== orgId ||
    (snap.data()?.['status'] as string) !== 'pending'
  ) {
    return false;
  }
  await ref.update(toDoc({ status: 'revoked' }));
  return true;
}

/**
 * Accept an invitation: atomically re-checks it is still pending and unexpired,
 * adds the member at the invited role, and marks the row accepted. Returns false
 * when the invitation is no longer redeemable (revoked/accepted/expired/missing).
 * The org_members write is conflict-safe so an already-member user just keeps
 * their existing role. The status+expiry precondition runs inside a transaction
 * (replacing the SQL UPDATE…WHERE atomic claim).
 */
export async function acceptInvitation(db: Db, invitationId: string, userId: string): Promise<boolean> {
  const inviteRef = col(db, 'org_invitations').doc(invitationId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists) return null;
    const status = snap.data()?.['status'] as string;
    const expiresAt = snap.data()?.['expiresAt'] as Date | undefined;
    const expires = expiresAt instanceof Date ? expiresAt : undefined;
    if (status !== 'pending' || !expires || expires.getTime() <= Date.now()) return null;
    tx.update(inviteRef, toDoc({ status: 'accepted' }));
    return { orgId: snap.data()?.['orgId'] as string, role: snap.data()?.['role'] as string };
  });
  if (!claimed) return false;
  // onConflictDoNothing on the member insert: keep an existing member's role.
  const memberRef = col(db, 'org_members').doc(`${claimed.orgId}_${userId}`);
  await memberRef
    .create(toDoc(applyDefaults({ orgId: claimed.orgId, userId, role: claimed.role }, `${claimed.orgId}_${userId}`)))
    .catch((e: unknown) => { if (!(e instanceof AlreadyExistsError)) throw e; });
  return true;
}
