import {
  getIntegration, credsForRow, listProjectRepos, resolveRepoRef, type Db,
  type RepoSnapshot,
} from '@intellilabs/core';
import { makeRepoReader, type RepoClient } from './repo-reader.js';

const MAX_FILE_BYTES = 256_000;
const MAX_FILES = 5_000;
const DIGEST_FILE_BUDGET = 60;        // key files whose contents go into the LLM digest
const SCAN_NAME = /(^|\/)(package\.json|wrangler\.(toml|json|jsonc)|Dockerfile|.*\.tf|firebase\.json)$/;
const SCAN_DIR = /(^|\/)infra\//;     // pulumi/IaC TS lives here

export interface SnapshotDeps { db: Db; client: RepoClient; config: { SECRETS_KEY?: string; GITHUB_APP_ID?: string; GITHUB_APP_PRIVATE_KEY?: string } }

/** Returns null when there is no connected code source / no repos (the precondition). */
export async function buildProjectSnapshot(deps: SnapshotDeps, orgId: string, projectId: string): Promise<{ snapshot: RepoSnapshot; digest: string } | null> {
  const integ = await getIntegration(deps.db, orgId, 'github');
  if (!integ || !integ.enabled) return null;
  const repos = await listProjectRepos(deps.db, projectId);
  if (repos.length === 0) return null;
  const creds = credsForRow(integ, deps.config);

  const deps_ = new Set<string>();
  const filePaths: string[] = [];
  const scannedContent: { path: string; content: string }[] = [];
  const digestParts: string[] = [];

  for (const repo of repos) {
    const ref = resolveRepoRef(repo);
    const { sha } = await deps.client.getRefInfo(creds, repo.repoFullName, ref);
    const tree = await deps.client.listTree(creds, repo.repoFullName, sha);
    const blobs = tree.entries.filter((e) => e.type === 'blob');
    for (const b of blobs) filePaths.push(`${repo.repoFullName}/${b.path}`);

    // scan a bounded set for deterministic detection
    for (const b of blobs) {
      if (SCAN_NAME.test(b.path) || SCAN_DIR.test(b.path)) {
        let content: string | null = null;
        try { content = (await deps.client.getFile(creds, repo.repoFullName, b.path, sha)).text; } catch { content = null; }
        if (content) {
          scannedContent.push({ path: `${repo.repoFullName}/${b.path}`, content });
          if (b.path.endsWith('package.json')) {
            try {
              const pj = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
              for (const d of Object.keys(pj.dependencies ?? {})) deps_.add(d);
              for (const d of Object.keys(pj.devDependencies ?? {})) deps_.add(d);
            } catch { /* ignore */ }
          }
        }
      }
    }

    // digest: the file tree + contents of a budget of entrypoint-ish files
    const reader = await makeRepoReader({ client: deps.client, creds, repo: repo.repoFullName, ref, maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES });
    digestParts.push(`# repo: ${repo.repoFullName} @ ${reader.commitSha}\n## files\n${reader.files.map((f) => f.path).join('\n')}`);
    const keyFiles = reader.files.filter((f) => /(^|\/)(index|main|server|app|worker)\.[tj]sx?$/.test(f.path) || /package\.json$/.test(f.path)).slice(0, DIGEST_FILE_BUDGET);
    for (const f of keyFiles) {
      const c = await reader.read(f.path);
      if (c) digestParts.push(`## ${f.path}\n${c.slice(0, 4000)}`);
    }
  }

  return {
    snapshot: { deps: deps_, filePaths, scannedContent },
    digest: digestParts.join('\n\n').slice(0, 180_000),
  };
}
