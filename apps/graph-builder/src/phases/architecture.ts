import {
  finishBuild,
  setBuildPhase,
  addBuildTokens,
  insertNodes,
  insertEdges,
  deleteBuildNodesByKind,
  makeLogger,
  type Db,
  type NewNode,
} from '@intellilabs/core';

const log = makeLogger({ service: 'graph-builder', projectId: process.env.GCP_PROJECT_ID ?? 'local' });
import type { SkillContribution } from '@intellilabs/kg-skills';
import type { RunPhaseDeps } from '../run-phase.js';
import type { BuildJob } from '../app.js';
import { nodesByKind } from '../kg-store.js';

/** Cap on fan-out units (top-level areas) we send to the LLM per build. */
const MAX_AREAS = 24;
/** Bounded parallelism for area LLM calls. */
const FANOUT_CONCURRENCY = 6;

/** One structural file node loaded from the build, with its repo + db id. */
interface FileNode { id: string; name: string; repoFullName: string }

/** A fan-out unit: all files under one top-level dir of one repo. */
interface Area {
  /** `<repoFullName>:<topDir>` — stable key for the area. */
  key: string;
  repoFullName: string;
  topDir: string;
  files: FileNode[];
}

/** Top-level directory of a path (`src/auth/login.ts` → `src`; `index.ts` → `(root)`). */
function topDirOf(path: string): string {
  const i = path.indexOf('/');
  return i === -1 ? '(root)' : path.slice(0, i);
}

/** Group the build's file nodes into per-repo, per-top-level-dir areas (sorted, stable). */
function groupAreas(files: FileNode[]): Area[] {
  const byKey = new Map<string, Area>();
  for (const f of files) {
    const topDir = topDirOf(f.name);
    const key = `${f.repoFullName}:${topDir}`;
    let area = byKey.get(key);
    if (!area) { area = { key, repoFullName: f.repoFullName, topDir, files: [] }; byKey.set(key, area); }
    area.files.push(f);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Run an async mapper over items with a bounded number in flight at once. */
async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Phase 2 — architecture (agentic, LLM-backed).
 *
 * Loads the structural file nodes for the build, groups them into per-repo top-level
 * areas (the fan-out unit), then for each area composes the `extract-architecture`
 * skill's prompt and asks the model (gemini-3.1-pro) to enumerate components + the
 * files composing each. Component nodes are merged across areas by name (a component
 * spanning areas/repos collapses to one node, unioning its `composes` edges), and
 * `composes` file refs resolve back to the structural file node ids (repo-scoped, with
 * a global name fallback). Idempotent: deletes its own prior `component` nodes/edges
 * before inserting. Advances the build to `flows` and re-enqueues.
 *
 * When `deps.semantic` is absent (local/tests) the LLM step is skipped: the graph stays
 * structural and the phase still advances + enqueues.
 */
export async function runArchitecture(deps: RunPhaseDeps, job: BuildJob): Promise<void> {
  const buildId = job.buildId;
  if (!buildId) {
    // No build to operate on: nothing we can persist or advance. Record an error if we can.
    log.error({}, 'graph-builder: architecture phase requires a buildId');
    return;
  }

  const db: Db = deps.db;

  try {
    // Idempotency: clear any prior architecture output for this build before inserting.
    await deleteBuildNodesByKind(db, buildId, ['component']);

    // Load structural file nodes for the build (the fan-out + edge-resolution source).
    // Architecture composes over file nodes; load only those for the build.
    const fileRows = await nodesByKind(db, buildId, ['file']);
    const files: FileNode[] = fileRows.map((r) => ({ id: r.id, name: r.name, repoFullName: r.repoFullName ?? '' }));

    // Resolution maps: repo-scoped (repoFullName + name) and a global name fallback.
    const idByRepoName = new Map<string, string>();
    const idByName = new Map<string, string>();
    for (const f of files) {
      idByRepoName.set(`${f.repoFullName}\n${f.name}`, f.id);
      // Last-writer-wins for global fallback; only used when the model omits a repo.
      idByName.set(f.name, f.id);
    }

    // Without a semantic backend we cannot run the extractor; degrade to structural-only.
    if (!deps.semantic) {
      await advance(deps, job, buildId);
      return;
    }

    const archSkills = deps.skills.skillsFor('architecture').filter((s) => s.promptFragment && s.parse);

    let areas = groupAreas(files);
    if (areas.length > MAX_AREAS) {
      log.warn({ count: areas.length, max: MAX_AREAS, buildId }, `graph-builder: architecture truncating areas ${areas.length} → ${MAX_AREAS} (build ${buildId})`);
      areas = areas.slice(0, MAX_AREAS);
    }

    // Fan out: one (or more) LLM call(s) per area, bounded concurrency.
    const semantic = deps.semantic;
    const perArea = await mapBounded(areas, FANOUT_CONCURRENCY, async (area) => {
      const summary = area.files.map((f) => f.name).join('\n');
      const contributions: { area: Area; contribution: SkillContribution }[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      for (const skill of archSkills) {
        const prompt = skill.promptFragment!({ summary, area: area.topDir, repoFullName: area.repoFullName });
        const res = await semantic.llm(job.orgId, prompt);
        inputTokens += res.inputTokens;
        outputTokens += res.outputTokens;
        await deps.recordInvocation?.({
          source: 'kg-build',
          orgId: job.orgId,
          model: 'gemini-3.1-pro-preview',
          provider: 'google-vertex',
          buildId: job.buildId ?? null,
          operationId: job.operationId ?? null,
          phase: 'architecture',
          messages: [{ role: 'user', content: prompt }],
          output: res.text,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          status: 'ok',
        });
        const contribution = skill.parse!(res.text, { area: area.topDir, repoFullName: area.repoFullName });
        contributions.push({ area, contribution });
      }
      return { contributions, inputTokens, outputTokens };
    });

    let tokens = 0;
    for (const r of perArea) tokens += r.inputTokens + r.outputTokens;
    await addBuildTokens(db, buildId, tokens);

    // Merge components across areas by name. A component keeps one node; its
    // `composes` edges are unioned (deduped by resolved file id). repoFullName is
    // single-repo when every contribution to it came from the same repo, else null.
    interface MergedComp { name: string; digest: string | null; repos: Set<string>; fileIds: Set<string> }
    const merged = new Map<string, MergedComp>();

    for (const r of perArea) {
      for (const { area, contribution } of r.contributions) {
        // Index this contribution's component → its declared file refs (from composes edges).
        const filesByComp = new Map<string, string[]>();
        for (const e of contribution.edges) {
          if (e.relation !== 'composes') continue;
          const list = filesByComp.get(e.srcName) ?? [];
          list.push(e.dstName);
          filesByComp.set(e.srcName, list);
        }

        for (const node of contribution.nodes) {
          if (node.kind !== 'component') continue;
          let comp = merged.get(node.name);
          if (!comp) { comp = { name: node.name, digest: node.digest ?? null, repos: new Set(), fileIds: new Set() }; merged.set(node.name, comp); }
          if (!comp.digest && node.digest) comp.digest = node.digest;
          comp.repos.add(area.repoFullName);

          for (const fileRef of filesByComp.get(node.name) ?? []) {
            // Resolve a model file ref → a structural file node id. Prefer the area's
            // repo; fall back to a global name match when the model omits the repo.
            const id =
              idByRepoName.get(`${area.repoFullName}\n${fileRef}`) ??
              idByName.get(fileRef);
            if (id) comp.fileIds.add(id);
          }
        }
      }
    }

    // Persist merged component nodes, then composes edges to resolved file ids.
    const compNodes: NewNode[] = [...merged.values()].map((c) => ({
      orgId: job.orgId,
      buildId,
      repoFullName: c.repos.size === 1 ? [...c.repos][0]! : '(project)',
      kind: 'component',
      name: c.name,
      digest: c.digest,
    }));
    const inserted = await insertNodes(db, compNodes);
    const compIdByName = new Map(inserted.map((r) => [r.name, r.id]));

    const edgeRows: { orgId: string; buildId: string; srcNodeId: string; dstNodeId: string; relation: string }[] = [];
    for (const c of merged.values()) {
      const compId = compIdByName.get(c.name);
      if (!compId) continue;
      for (const fileId of c.fileIds) {
        edgeRows.push({ orgId: job.orgId, buildId, srcNodeId: compId, dstNodeId: fileId, relation: 'composes' });
      }
    }
    await insertEdges(db, edgeRows);

    await advance(deps, job, buildId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await finishBuild(db, buildId, { status: 'error', error: msg }); } catch { /* DB unreachable */ }
  }
}

/** Advance the build to the `flows` phase and re-enqueue. */
async function advance(deps: RunPhaseDeps, job: BuildJob, buildId: string): Promise<void> {
  await setBuildPhase(deps.db, buildId, 'flows');
  await deps.kgPublisher.publish({
    orgId: job.orgId,
    projectId: job.projectId,
    repoFullName: job.repoFullName,
    ref: job.ref,
    mode: job.mode,
    buildId,
    operationId: job.operationId ?? undefined,
    phase: 'flows',
  });
}
