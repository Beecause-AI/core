import {
  decryptSecret, getSyncState, startSync, recordPage, markDone, markError, upsertCatalogRepo,
  type Db, type IntegrationMetadata, type OrgIntegration,
} from '@intellilabs/core';
import type { GithubClient, AppCreds } from './client.js';

export interface SyncDeps {
  db: Db;
  client: GithubClient;
  secretsKey: Buffer;
  appId?: string;
  appPrivateKey?: string;
}

function appCredsFor(row: OrgIntegration, d: SyncDeps): AppCreds {
  const meta = (row.metadata as IntegrationMetadata) ?? {};
  if (row.mode === 'agent_app') {
    return { appId: d.appId!, privateKey: d.appPrivateKey!, installationId: meta.installationId!, baseUrl: undefined };
  }
  return { appId: meta.appId!, privateKey: decryptSecret(row.secretCiphertext!, d.secretsKey), installationId: meta.installationId!, baseUrl: row.baseUrl ?? undefined };
}

function fetchPage(row: OrgIntegration, d: SyncDeps, page: number) {
  return row.mode === 'pat'
    ? d.client.listReposDetailed({ mode: 'pat', token: decryptSecret(row.secretCiphertext!, d.secretsKey), baseUrl: row.baseUrl ?? undefined, page })
    : d.client.listReposDetailed({ mode: row.mode as 'agent_app' | 'custom_app', ...appCredsFor(row, d), page });
}

/**
 * Advance the catalog sync by one GitHub page. Starts a fresh pass if not already
 * syncing. Returns the running status so the caller (web page) can poll to completion.
 */
export async function advanceCatalogSync(
  row: OrgIntegration, d: SyncDeps,
): Promise<{ status: 'idle' | 'syncing' | 'error'; repoCount: number; done: boolean }> {
  let state = await getSyncState(d.db, row.id);
  if (state.status !== 'syncing') state = await startSync(d.db, row.id);
  const page = state.nextCursor ? Number(state.nextCursor) : 1;
  try {
    const { repos, nextPage } = await fetchPage(row, d, page);
    for (const r of repos) {
      await upsertCatalogRepo(d.db, row.id, { repoFullName: r.fullName, defaultBranch: r.defaultBranch, private: r.private });
    }
    const repoCount = state.repoCount + repos.length;
    if (nextPage === null) {
      await markDone(d.db, row.id, repoCount);
      return { status: 'idle', repoCount, done: true };
    }
    await recordPage(d.db, row.id, repoCount, String(nextPage));
    return { status: 'syncing', repoCount, done: false };
  } catch (e) {
    await markError(d.db, row.id, e instanceof Error ? e.message : 'sync failed');
    return { status: 'error', repoCount: state.repoCount, done: true };
  }
}
