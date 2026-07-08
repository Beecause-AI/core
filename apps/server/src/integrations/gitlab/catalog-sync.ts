import {
  getGitlabSyncState, startGitlabSync, recordGitlabPage, markGitlabDone, markGitlabError,
  upsertGitlabCatalogRepo, decryptSecret, type Db, type OrgIntegration,
} from '@intellilabs/core';
import type { GitlabClient } from './client.js';

export interface SyncDeps { db: Db; client: GitlabClient; secretsKey: Buffer; }

export async function advanceCatalogSync(
  row: OrgIntegration, d: SyncDeps,
): Promise<{ status: 'idle' | 'syncing' | 'error'; repoCount: number; done: boolean }> {
  let state = await getGitlabSyncState(d.db, row.id);
  if (state.status !== 'syncing') state = await startGitlabSync(d.db, row.id);
  const page = state.nextCursor ? Number(state.nextCursor) : 1;
  try {
    const { repos, nextPage } = await d.client.listReposDetailed({
      token: decryptSecret(row.secretCiphertext!, d.secretsKey), baseUrl: row.baseUrl ?? undefined, page,
    });
    for (const r of repos) {
      await upsertGitlabCatalogRepo(d.db, row.id, { repoFullName: r.fullName, defaultBranch: r.defaultBranch, private: r.private });
    }
    const repoCount = state.repoCount + repos.length;
    if (nextPage === null) { await markGitlabDone(d.db, row.id, repoCount); return { status: 'idle', repoCount, done: true }; }
    await recordGitlabPage(d.db, row.id, repoCount, String(nextPage));
    return { status: 'syncing', repoCount, done: false };
  } catch (e) {
    await markGitlabError(d.db, row.id, e instanceof Error ? e.message : 'sync failed');
    return { status: 'error', repoCount: state.repoCount, done: true };
  }
}
