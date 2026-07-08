import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, FieldValue } from '../store/codec.js';
import { AlreadyExistsError, type Snapshot } from '../ports/store.js';
import type { GitlabCatalogSyncRow } from '../store/types.js';

const TTL_MS = 60 * 60 * 1000; // 1h

/** This table's PK is orgIntegrationId (natural) → doc id; it has no id/createdAt columns. */
function defaults(orgIntegrationId: string): GitlabCatalogSyncRow {
  return {
    orgIntegrationId, status: 'idle', nextCursor: null, repoCount: 0,
    startedAt: null, finishedAt: null, error: null,
  };
}

/** fromDoc adds `id` (== doc id); the row type keys on orgIntegrationId, so drop `id`. */
function rowFrom(snap: Snapshot): GitlabCatalogSyncRow {
  const { id: _omit, ...rest } = fromDoc<GitlabCatalogSyncRow & { id: string }>(snap);
  return rest as GitlabCatalogSyncRow;
}

/** Get the sync row, creating a default 'idle' row if absent. */
export async function getGitlabSyncState(db: Db, orgIntegrationId: string): Promise<GitlabCatalogSyncRow> {
  const ref = col(db, 'gitlab_catalog_sync').doc(orgIntegrationId);
  // onConflictDoNothing: create the default row only if absent.
  await ref.create(toDoc(defaults(orgIntegrationId))).catch((e: unknown) => { if (!(e instanceof AlreadyExistsError)) throw e; });
  return rowFrom(await ref.get());
}

/** Begin a fresh full pass: status=syncing, cursor reset, count zeroed. */
export async function startGitlabSync(db: Db, orgIntegrationId: string): Promise<GitlabCatalogSyncRow> {
  const ref = col(db, 'gitlab_catalog_sync').doc(orgIntegrationId);
  // onConflictDoUpdate over the natural key → merge-set.
  await ref.set(toDoc({
    orgIntegrationId, status: 'syncing', nextCursor: null, repoCount: 0,
    startedAt: FieldValue.serverTimestamp(), finishedAt: null, error: null,
  }), { merge: true });
  return rowFrom(await ref.get());
}

/** After a page: advance count + store the next GitLab page cursor. */
export async function recordGitlabPage(db: Db, orgIntegrationId: string, repoCount: number, nextCursor: string | null): Promise<void> {
  await col(db, 'gitlab_catalog_sync').doc(orgIntegrationId).update(toDoc({ repoCount, nextCursor }));
}

/** Pass complete: back to idle, stamp finishedAt, clear cursor/error. */
export async function markGitlabDone(db: Db, orgIntegrationId: string, repoCount: number): Promise<void> {
  await col(db, 'gitlab_catalog_sync').doc(orgIntegrationId).update(toDoc({
    status: 'idle', repoCount, nextCursor: null, finishedAt: FieldValue.serverTimestamp(), error: null,
  }));
}

export async function markGitlabError(db: Db, orgIntegrationId: string, message: string): Promise<void> {
  await col(db, 'gitlab_catalog_sync').doc(orgIntegrationId).update(toDoc({ status: 'error', error: message }));
}

/** Pure: stale if never finished a pass or the last finish is older than the 1h TTL. */
export function isGitlabCatalogStale(state: { finishedAt: Date | string | null } | null, now = Date.now()): boolean {
  const at = state?.finishedAt ?? null;
  if (!at) return true;
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return now - ms > TTL_MS;
}
