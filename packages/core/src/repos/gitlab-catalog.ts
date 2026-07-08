import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { GitlabRepoCatalogRow } from '../store/types.js';

export interface GitlabCatalogRepo {
  repoFullName: string;
  defaultBranch: string | null;
  private: boolean;
}

export interface GitlabSearchCatalogResult {
  rows: GitlabRepoCatalogRow[];
  nextCursor: string | null;
  total: number;
}

/** Deterministic doc id emulating the (orgIntegrationId, repoFullName) unique index.
 *  repoFullName contains '/', illegal in Firestore ids → base64url-encode it. */
function catalogId(orgIntegrationId: string, repoFullName: string): string {
  return `${orgIntegrationId}_${Buffer.from(repoFullName).toString('base64url')}`;
}

/**
 * Searched + keyset-paginated catalog read. Scoped to one integration. `q` is a
 * case-insensitive substring on repoFullName; `cursor` is the last repoFullName of
 * the previous page; rows are ordered by repoFullName.
 *
 * Firestore has no substring/ILIKE operator, so the integration's repos are fetched
 * and the substring filter + keyset pagination are applied in JS. Scoped reads keep
 * the working set small (one integration's repos).
 */
export async function searchGitlabCatalog(
  db: Db, orgIntegrationId: string, opts: { q?: string; cursor?: string | null; limit?: number },
): Promise<GitlabSearchCatalogResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const q = (opts.q ?? '').trim().toLowerCase();

  const snaps = await col(db, 'gitlab_repo_catalog').where('orgIntegrationId', '==', orgIntegrationId).get();
  let all = snaps.map((d) => fromDoc<GitlabRepoCatalogRow>(d));
  if (q) all = all.filter((r) => r.repoFullName.toLowerCase().includes(q));
  all.sort((a, b) => (a.repoFullName < b.repoFullName ? -1 : a.repoFullName > b.repoFullName ? 1 : 0));

  const total = all.length;
  const afterCursor = opts.cursor ? all.filter((r) => r.repoFullName > opts.cursor!) : all;
  const hasMore = afterCursor.length > limit;
  const page = hasMore ? afterCursor.slice(0, limit) : afterCursor;
  const nextCursor = hasMore ? page[page.length - 1]!.repoFullName : null;
  return { rows: page, nextCursor, total };
}

export async function getGitlabCatalogRepo(
  db: Db, orgIntegrationId: string, repoFullName: string,
): Promise<GitlabRepoCatalogRow | null> {
  const snap = await col(db, 'gitlab_repo_catalog').doc(catalogId(orgIntegrationId, repoFullName)).get();
  return snap.exists ? fromDoc<GitlabRepoCatalogRow>(snap) : null;
}

export async function upsertGitlabCatalogRepo(db: Db, orgIntegrationId: string, repo: GitlabCatalogRepo): Promise<void> {
  const ref = col(db, 'gitlab_repo_catalog').doc(catalogId(orgIntegrationId, repo.repoFullName));
  const snap = await ref.get();
  if (snap.exists) {
    // onConflictDoUpdate: refresh branch/private/syncedAt; keep id.
    await ref.update(toDoc({
      defaultBranch: repo.defaultBranch, private: repo.private, syncedAt: FieldValue.serverTimestamp(),
    }));
    return;
  }
  const row = applyDefaults({
    orgIntegrationId, repoFullName: repo.repoFullName, defaultBranch: repo.defaultBranch,
    private: repo.private, syncedAt: FieldValue.serverTimestamp() as unknown as Date,
  }, ref.id);
  // This table has no createdAt column; drop the applyDefaults-injected one.
  const { createdAt: _omit, ...doc } = row;
  await ref.set(toDoc(doc));
}

export async function removeGitlabCatalogRepo(db: Db, orgIntegrationId: string, repoFullName: string): Promise<void> {
  const ref = col(db, 'gitlab_repo_catalog').doc(catalogId(orgIntegrationId, repoFullName));
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
}
