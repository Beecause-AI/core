import {
  createBuild,
  startBuildOperation,
  finishBuild,
  setBuildPhase,
  insertNodes,
  insertEdges,
  deleteBuildNodesByKind,
  listProjectRepos,
  getIntegration,
  credsForRow,
  resolveRepoRef,
  type NewNode,
} from '@intellilabs/core';
import type { DetectInput, SkillCandidate } from '@intellilabs/kg-skills';
import { makeRepoReader } from '../repo-reader.js';
import { parseRepo } from '../parse-repo.js';
import type { RunPhaseDeps } from '../run-phase.js';
import type { BuildJob } from '../app.js';

const MAX_FILE_BYTES = 256_000;
const MAX_FILES = 5_000;
// Bounded set of files we read content for, to feed deterministic detectors.
const MANIFEST_NAMES = new Set(['package.json', 'docker-compose.yml', 'docker-compose.yaml']);
function isManifestPath(path: string): boolean {
  const file = path.split('/').pop() ?? '';
  return MANIFEST_NAMES.has(file) || path.endsWith('.sql');
}

/** One repo's structural extraction: file/module nodes + contains/imports edges + detector input. */
interface RepoStructure {
  repoFullName: string;
  commitSha: string;
  truncated: boolean;
  nodes: NewNode[];
  edges: { srcName: string; dstName: string; relation: string }[];
  detectInput: DetectInput;
}

function parseJsonSafe(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

async function readRepoStructure(
  deps: RunPhaseDeps,
  orgId: string,
  buildId: string,
  creds: unknown,
  repoFullName: string,
  ref: string | null,
): Promise<RepoStructure> {
  // Resolve the ref + full tree once; the reader filters to parseable files, but
  // detectors need manifest/config files (package.json, docker-compose, *.sql) that
  // the parseable filter drops, so we scan the raw tree for those separately.
  const { sha } = await deps.client.getRefInfo(creds, repoFullName, ref);
  const tree = await deps.client.listTree(creds, repoFullName, sha);
  const allTreePaths = tree.entries.filter((e) => e.type === 'blob').map((e) => e.path);

  const reader = await makeRepoReader({
    client: deps.client,
    creds,
    repo: repoFullName,
    ref,
    maxFileBytes: MAX_FILE_BYTES,
    maxFiles: MAX_FILES,
  });

  // Reuse the deterministic Pass-A skeleton (file/module nodes + contains/imports).
  const g = await parseRepo(reader, repoFullName);

  const nodes: NewNode[] = g.nodes.map((n) => ({
    orgId,
    buildId,
    repoFullName,
    kind: n.kind,
    name: n.name,
    codeRefPath: n.codeRefPath ?? null,
    commitSha: reader.commitSha,
  }));

  // parse-repo edges reference tmpIds; for file/module the tmpId == name (file path
  // or `dir:<path>`), but module names are the dir path without the `dir:` prefix.
  // Resolve tmpId → node name so edges key by name (matching insertNodes' name map).
  const nameByTmp = new Map<string, string>();
  for (const n of g.nodes) {
    // module tmpIds are `dir:<path>`; file tmpIds are the path itself.
    nameByTmp.set(n.tmpId, n.name);
  }
  const edges = g.edges
    .map((e) => ({
      srcName: nameByTmp.get(e.srcTmpId),
      dstName: nameByTmp.get(e.dstTmpId),
      relation: e.relation as string,
    }))
    .filter((e): e is { srcName: string; dstName: string; relation: string } => Boolean(e.srcName && e.dstName));

  // Build the detector input: all blob paths, plus content for a bounded manifest set
  // (package.json, docker-compose*, *.sql) read directly from GitHub.
  //
  // Monorepo-aware: MERGE deps/devDeps from every package.json found (union), so that
  // sub-package deps (e.g. @opentelemetry/* in apps/engine-worker/package.json) are
  // visible to deterministic detectors. Previous "last-wins" single-var approach missed
  // any package.json that was not last in tree order.
  const mergedDeps: Record<string, string> = {};
  const mergedDevDeps: Record<string, string> = {};
  let foundPackageJson = false;
  let dockerCompose: unknown;
  const detectFiles: DetectInput['files'] = [];
  for (const path of allTreePaths) {
    if (isManifestPath(path)) {
      let content: string | null = null;
      try { content = (await deps.client.getFile(creds, repoFullName, path, sha)).text; } catch { content = null; }
      detectFiles.push({ path, content: content ?? undefined });
      const file = path.split('/').pop() ?? '';
      if (file === 'package.json' && content) {
        const parsed = parseJsonSafe(content) as Record<string, unknown> | undefined;
        if (parsed) {
          foundPackageJson = true;
          Object.assign(mergedDeps, parsed['dependencies'] ?? {});
          Object.assign(mergedDevDeps, parsed['devDependencies'] ?? {});
        }
      }
    } else {
      detectFiles.push({ path });
    }
  }
  const packageJson: unknown = foundPackageJson
    ? { dependencies: mergedDeps, devDependencies: mergedDevDeps }
    : undefined;

  return {
    repoFullName,
    commitSha: reader.commitSha,
    truncated: reader.truncated,
    nodes,
    edges,
    detectInput: {
      repoFullName,
      files: detectFiles,
      manifests: { packageJson, dockerCompose },
    },
  };
}

/**
 * Phase 1 — structure (deterministic, no LLM).
 * For every project repo: read tree + files → file/module nodes + contains/imports edges,
 * then run `structure` detector skills for datastore/external/signal candidates. Persists
 * everything under one project build, advances phase to `architecture`, and re-enqueues.
 */
export async function runStructure(deps: RunPhaseDeps, job: BuildJob): Promise<void> {
  let buildId = job.buildId;
  // One operation per build (kind='kg-build', ref_id=build.id) wraps the whole
  // multi-phase build; its id rides along the BuildJob so each phase can stamp it
  // onto the invocations it records. Created here at build start; finished in finalize.
  let operationId = job.operationId ?? null;
  if (!buildId) {
    const build = await createBuild(deps.db, {
      orgId: job.orgId,
      repoFullName: job.repoFullName,
      projectId: job.projectId ?? null,
      mode: job.mode,
      phase: 'structure',
    });
    buildId = build.id;
    operationId = await startBuildOperation(deps.db, { id: build.id, orgId: build.orgId, projectId: build.projectId });
  }

  // Idempotency: clear any previously-inserted structure-owned nodes (and their edges)
  // so that a redelivered job produces the same result as a fresh run.
  await deleteBuildNodesByKind(deps.db, buildId, ['file', 'module', 'datastore', 'external', 'metric', 'log', 'trace']);

  try {
    if (!job.projectId) throw new Error('structure phase requires a projectId');

    const integ = await getIntegration(deps.db, job.orgId, 'github');
    if (!integ || !integ.enabled) throw new Error('github integration not connected');
    const creds = credsForRow(integ, deps.config);

    const repos = await listProjectRepos(deps.db, job.projectId);

    // Collect per-repo structures, then candidates for detector dedup.
    const repoStructures: RepoStructure[] = [];
    const candidates: SkillCandidate[] = [];

    for (const repo of repos) {
      const ref = resolveRepoRef(repo);
      const s = await readRepoStructure(deps, job.orgId, buildId, creds, repo.repoFullName, ref);
      repoStructures.push(s);

      for (const skill of deps.skills.skillsFor('structure')) {
        if (skill.detect) candidates.push(...skill.detect(s.detectInput));
      }
    }

    // Dedup detector candidates by (kind, name) GLOBALLY — a Postgres shared across
    // repos is one node. Keep first occurrence.
    const seenDetector = new Set<string>();
    const detectorNodes: NewNode[] = [];
    for (const c of candidates) {
      const key = `${c.kind}\n${c.name}`;
      if (seenDetector.has(key)) continue;
      seenDetector.add(key);
      detectorNodes.push({
        orgId: job.orgId,
        buildId,
        repoFullName: c.repoFullName ?? job.repoFullName,
        kind: c.kind,
        name: c.name,
        digest: c.digest ?? null,
        metadata: (c.metadata as Record<string, unknown> | null) ?? null,
      });
    }

    // Persist structural nodes (all repos) + detector nodes together, then build a
    // repo-scoped id map so that file/module edges resolve within the correct repo.
    // Two repos may both have a file named `src/index.ts`; keying by
    // (repoFullName, kind, name) ensures each repo's edges resolve to its own nodes.
    const allNodes: NewNode[] = [...repoStructures.flatMap((s) => s.nodes), ...detectorNodes];
    const rows = await insertNodes(deps.db, allNodes);

    // repo-scoped map: `repoFullName\nkind\nname` → id  (for structural file/module nodes)
    const idByRepoKey = new Map(
      rows
        .filter((r) => r.kind === 'file' || r.kind === 'module')
        .map((r) => [`${r.repoFullName}\n${r.kind}\n${r.name}`, r.id]),
    );

    // Build edges per repo, resolving src/dst within that repo's node scope only.
    const edgeRows: { orgId: string; buildId: string; srcNodeId: string; dstNodeId: string; relation: string }[] = [];
    for (const s of repoStructures) {
      for (const e of s.edges) {
        const repoPrefix = s.repoFullName;
        const src =
          idByRepoKey.get(`${repoPrefix}\nfile\n${e.srcName}`) ??
          idByRepoKey.get(`${repoPrefix}\nmodule\n${e.srcName}`);
        const dst =
          idByRepoKey.get(`${repoPrefix}\nfile\n${e.dstName}`) ??
          idByRepoKey.get(`${repoPrefix}\nmodule\n${e.dstName}`);
        if (src && dst) {
          edgeRows.push({ orgId: job.orgId, buildId, srcNodeId: src, dstNodeId: dst, relation: e.relation });
        }
      }
    }
    await insertEdges(deps.db, edgeRows);

    await setBuildPhase(deps.db, buildId, 'architecture');
    await deps.kgPublisher.publish({
      orgId: job.orgId,
      projectId: job.projectId,
      repoFullName: job.repoFullName,
      ref: job.ref,
      mode: job.mode,
      buildId,
      operationId: operationId ?? undefined,
      phase: 'architecture',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await finishBuild(deps.db, buildId, { status: 'error', error: msg }); } catch { /* DB unreachable */ }
  }
}
