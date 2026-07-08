import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { ProjectRepo } from '../store/types.js';

export interface AddProjectRepoInput {
  projectId: string;
  orgIntegrationId: string;
  repoFullName: string;
  defaultBranch: string | null;
  addedByUserId: string;
}

/** Postgres-compatible unique-violation error so callers/tests keep matching `code === '23505'`. */
function uniqueViolation(constraint: string): Error & { code: string } {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`) as Error & { code: string };
  err.code = '23505';
  return err;
}

export async function listProjectRepos(db: Db, projectId: string): Promise<ProjectRepo[]> {
  const snaps = await col(db, 'project_repos')
    .where('projectId', '==', projectId).orderBy('repoFullName', 'asc').get();
  return snaps.map((d) => fromDoc<ProjectRepo>(d));
}

export async function addProjectRepo(db: Db, input: AddProjectRepoInput): Promise<ProjectRepo> {
  // Enforce unique(projectId, repoFullName) (Postgres had a unique index; Firestore does not).
  const dup = await col(db, 'project_repos')
    .where('projectId', '==', input.projectId).where('repoFullName', '==', input.repoFullName).limit(1).get();
  if (dup.length > 0) throw uniqueViolation('project_repos_project_repo');

  const ref = col(db, 'project_repos').doc();
  const row = applyDefaults({ ...input, refType: null as string | null, ref: null as string | null }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<ProjectRepo>(await ref.get());
}

export async function removeProjectRepo(db: Db, projectId: string, repoId: string): Promise<boolean> {
  const ref = col(db, 'project_repos').doc(repoId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

export type RepoRef = { refType: 'branch' | 'commit' | null; ref: string | null };

/** Set (or clear) the per-repo ref pin for a project repo. Returns false if no row matched. */
export async function setProjectRepoRef(db: Db, projectId: string, repoFullName: string, pin: RepoRef): Promise<boolean> {
  const snaps = await col(db, 'project_repos')
    .where('projectId', '==', projectId).where('repoFullName', '==', repoFullName).get();
  if (snaps.length === 0) return false;
  await Promise.all(snaps.map((d) => col(db, 'project_repos').doc(d.id).update(toDoc({ refType: pin.refType, ref: pin.ref }))));
  return true;
}

/** Resolve the ref string to pass to GitHub: configured ref → defaultBranch → null (repo default). */
export function resolveRepoRef(row: ProjectRepo): string | null {
  return row.ref ?? row.defaultBranch ?? null;
}
