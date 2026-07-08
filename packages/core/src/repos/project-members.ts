import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import { getAllDocs } from '../store/query.js';
import type { ProjectMember, User } from '../store/types.js';

// These functions take a projectId without an orgId: callers MUST have already
// verified the project belongs to the request's org (the route guards
// requireProjectMember/requireProjectAdmin do this via getProject(orgId,id)).
// Do not call them on an unvalidated projectId — that would cross tenants.

export async function getProjectRole(db: Db, projectId: string, userId: string): Promise<'admin' | 'user' | null> {
  const snap = await col(db, 'project_members').doc(`${projectId}_${userId}`).get();
  return snap.exists ? (snap.data()?.['role'] as 'admin' | 'user') : null;
}

export type ProjectMemberWithEmail = ProjectMember & { email: string | null };

export async function listProjectMembers(db: Db, projectId: string): Promise<ProjectMemberWithEmail[]> {
  const snaps = await col(db, 'project_members').where('projectId', '==', projectId).get();
  const members = snaps.map((d) => fromDoc<ProjectMember>(d));
  if (members.length === 0) return [];

  // left-join users(email): getAll the user docs, stitch email (null when never logged in).
  const userIds = [...new Set(members.map((m) => m.userId))];
  const emailByUserId = new Map<string, string>();
  for (const s of await getAllDocs(db, 'users', userIds)) {
    emailByUserId.set(s.id, fromDoc<User>(s).email);
  }
  return members.map((m) => ({ ...m, email: emailByUserId.get(m.userId) ?? null }));
}

/**
 * Add a user to a project by their userId, in `orgId`. Ensures org membership
 * (inserts orgMembers 'user' if absent) so project members ⊆ org members.
 */
export async function addProjectMember(
  db: Db, orgId: string, projectId: string, userId: string, role: 'admin' | 'user',
): Promise<void> {
  const orgMemberId = `${orgId}_${userId}`;
  const projectMemberId = `${projectId}_${userId}`;
  await db.runTransaction(async (tx) => {
    const orgRef = col(db, 'org_members').doc(orgMemberId);
    const pmRef = col(db, 'project_members').doc(projectMemberId);
    // reads first
    const orgSnap = await tx.get(orgRef);
    // writes: onConflictDoNothing for org membership; onConflictDoUpdate(role) for project membership.
    if (!orgSnap.exists) {
      tx.set(orgRef, toDoc(applyDefaults({ orgId, userId, role: 'user' }, orgMemberId)));
    }
    tx.set(pmRef, toDoc(applyDefaults({ projectId, userId, role }, projectMemberId)), { merge: true });
  });
}

export async function setProjectRole(db: Db, projectId: string, userId: string, role: 'admin' | 'user'): Promise<void> {
  const ref = col(db, 'project_members').doc(`${projectId}_${userId}`);
  const snap = await ref.get();
  if (snap.exists) await ref.update(toDoc({ role }));
}

export async function removeProjectMember(db: Db, projectId: string, userId: string): Promise<void> {
  const ref = col(db, 'project_members').doc(`${projectId}_${userId}`);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
}

/** Resolve a (lowercased) email to a userId via the users table, or null. */
export async function userIdByEmail(db: Db, email: string): Promise<string | null> {
  const snaps = await col(db, 'users').where('email', '==', email.trim().toLowerCase()).limit(1).get();
  return snaps[0] ? (snaps[0].data()?.['userId'] as string) : null;
}
