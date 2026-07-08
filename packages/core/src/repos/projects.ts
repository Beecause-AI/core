import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import { getAllDocs } from '../store/query.js';
import type { Project, OrgMember } from '../store/types.js';
import { AlreadyExistsError } from '../ports/store.js';

/** Postgres-compatible unique-violation error so callers/tests keep matching `code === '23505'`. */
function uniqueViolation(constraint: string): Error & { code: string } {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`) as Error & { code: string };
  err.code = '23505';
  return err;
}

async function loadDefault(db: Db, orgId: string): Promise<Project | null> {
  const snaps = await col(db, 'projects')
    .where('orgId', '==', orgId).where('slug', '==', 'default').get();
  return snaps[0] ? fromDoc<Project>(snaps[0]) : null;
}

/** Idempotently ensure an org has a `default` project with its owners/admins as project admins. */
export async function ensureDefaultProject(db: Db, orgId: string): Promise<Project> {
  const existing = await loadDefault(db, orgId);
  let project = existing;
  if (!project) {
    // Conflict-safe against concurrent callers: deterministic doc id `${orgId}_default`
    // means a racing create yields ALREADY_EXISTS, after which we re-read the winner's row.
    const ref = col(db, 'projects').doc(`${orgId}_default`);
    const now = new Date();
    const row = applyDefaults(
      { orgId, name: 'Default', slug: 'default', description: '', approvalPolicy: null, activeProposalId: null, updatedAt: now },
      ref.id,
    );
    try {
      await ref.create(toDoc(row));
      project = fromDoc<Project>(await ref.get());
    } catch (e) {
      if (!(e instanceof AlreadyExistsError)) throw e;
      project = (await loadDefault(db, orgId))!;
    }
  }

  const orgAdminSnaps = await col(db, 'org_members').where('orgId', '==', orgId).get();
  const admins = orgAdminSnaps
    .map((d) => fromDoc<OrgMember>(d))
    .filter((m) => m.role === 'owner' || m.role === 'manager');
  for (const m of admins) {
    const id = `${project.id}_${m.userId}`;
    const memberRow = applyDefaults({ projectId: project.id, userId: m.userId, role: 'admin' as const }, id);
    // onConflictDoNothing: only set if absent.
    await col(db, 'project_members').doc(id).create(toDoc(memberRow))
      .catch((e) => { if (!(e instanceof AlreadyExistsError)) throw e; });
  }
  return project;
}

export async function createProject(db: Db, orgId: string, input: { name: string; slug: string; description?: string }): Promise<Project> {
  // Enforce unique(orgId, slug) (Postgres had a unique index; Firestore does not).
  const dup = await col(db, 'projects')
    .where('orgId', '==', orgId).where('slug', '==', input.slug).limit(1).get();
  if (dup.length > 0) throw uniqueViolation('projects_org_slug');

  const ref = col(db, 'projects').doc();
  const now = new Date();
  const row = applyDefaults(
    { orgId, name: input.name, slug: input.slug, description: input.description ?? '', approvalPolicy: null, activeProposalId: null, copilotEnabled: false, reportsEnabled: false, updatedAt: now },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<Project>(await ref.get());
}

export async function getProject(db: Db, orgId: string, id: string): Promise<Project | null> {
  const snap = await col(db, 'projects').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<Project>(snap);
  return row.orgId === orgId ? row : null;
}

export async function renameProject(db: Db, orgId: string, id: string, name: string): Promise<Project | null> {
  const ref = col(db, 'projects').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return null;
  await ref.update(toDoc({ name }));
  return fromDoc<Project>(await ref.get());
}

/** Admins see all org projects; members see only the ones they belong to. */
export async function listProjectsForOrg(db: Db, orgId: string, userId: string, isOrgAdmin: boolean): Promise<Project[]> {
  if (isOrgAdmin) {
    const snaps = await col(db, 'projects').where('orgId', '==', orgId).orderBy('name', 'asc').get();
    return snaps.map((d) => fromDoc<Project>(d));
  }
  return memberProjects(db, orgId, userId, false);
}

/**
 * Projects the user is allowed to administer: every org project for an org
 * owner/manager; otherwise only projects where the user's project role is 'admin'.
 */
export async function listManageableProjects(db: Db, orgId: string, userId: string, isOrgAdmin: boolean): Promise<Project[]> {
  if (isOrgAdmin) {
    const snaps = await col(db, 'projects').where('orgId', '==', orgId).orderBy('name', 'asc').get();
    return snaps.map((d) => fromDoc<Project>(d));
  }
  return memberProjects(db, orgId, userId, true);
}

/** Projects the user belongs to within an org (optionally only where they're a project admin),
 *  ordered by name. Replaces the innerJoin(projectMembers) + selectDistinct path. */
async function memberProjects(db: Db, orgId: string, userId: string, adminOnly: boolean): Promise<Project[]> {
  const memberSnaps = await col(db, 'project_members').where('userId', '==', userId).get();
  const projectIds = memberSnaps
    .filter((d) => !adminOnly || (d.data()?.role as string) === 'admin')
    .map((d) => d.data()?.projectId as string);
  if (projectIds.length === 0) return [];

  const projects = (await getAllDocs(db, 'projects', [...new Set(projectIds)]))
    .map((s) => fromDoc<Project>(s))
    .filter((p) => p.orgId === orgId);
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProjectBySlug(db: Db, orgId: string, slug: string): Promise<Project | null> {
  const snaps = await col(db, 'projects')
    .where('orgId', '==', orgId).where('slug', '==', slug).limit(1).get();
  return snaps[0] ? fromDoc<Project>(snaps[0]) : null;
}

export async function updateProject(
  db: Db, orgId: string, id: string,
  patch: { name?: string; description?: string; slug?: string },
): Promise<Project | null> {
  const ref = col(db, 'projects').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return null;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return fromDoc<Project>(await ref.get());
}

export async function setProjectIssuesEnabled(
  db: Db,
  orgId: string,
  projectId: string,
  enabled: boolean,
): Promise<Project | null> {
  const ref = col(db, 'projects').doc(projectId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return null;
  await ref.update(toDoc({ issuesEnabled: enabled, updatedAt: FieldValue.serverTimestamp() }));
  return fromDoc<Project>(await ref.get());
}

export async function setProjectReportsEnabled(
  db: Db,
  orgId: string,
  projectId: string,
  enabled: boolean,
): Promise<Project | null> {
  const ref = col(db, 'projects').doc(projectId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return null;
  await ref.update(toDoc({ reportsEnabled: enabled, updatedAt: FieldValue.serverTimestamp() }));
  return fromDoc<Project>(await ref.get());
}

export async function deleteProject(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'projects').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.delete();
  return true;
}

/** Resolve just the orgId for a project without requiring callers to know the owning orgId first. */
export async function getProjectOrgId(db: Db, projectId: string): Promise<string | null> {
  const snap = await col(db, 'projects').doc(projectId).get();
  return snap.exists ? (snap.data()?.orgId as string) : null;
}

export async function projectScopeCounts(
  db: Db, projectId: string,
): Promise<{ repos: number; assistants: number; members: number }> {
  const [repos, assistants, members] = await Promise.all([
    col(db, 'project_repos').where('projectId', '==', projectId).count(),
    col(db, 'assistants').where('projectId', '==', projectId).count(),
    col(db, 'project_members').where('projectId', '==', projectId).count(),
  ]);
  return { repos, assistants, members };
}
