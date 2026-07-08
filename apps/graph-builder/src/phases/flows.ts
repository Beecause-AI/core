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
import { nodesByKind, edgesByRelation } from '../kg-store.js';

/** Cap on fan-out units (components) we send to the LLM per build. */
const MAX_COMPONENTS = 32;
/** Bounded parallelism for component LLM calls. */
const FANOUT_CONCURRENCY = 6;

/** A component node loaded from the build, with the files it composes. */
interface ComponentUnit {
  id: string;
  name: string;
  digest: string | null;
  repoFullName: string;
  files: { id: string; name: string; repoFullName: string }[];
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
 * Phase 3 — flows (agentic, LLM-backed).
 *
 * Loads the build's `component` nodes (and the file nodes each composes), then fans
 * out one (or more) `extract-flows` LLM call per component. The model enumerates the
 * end-to-end business flows the component participates in, plus the components each
 * flow touches and the files that implement it. Flows are merged by name across
 * components (a flow spanning multiple components collapses to one node, unioning its
 * `touches`/`implements_flow` edges). `touches` resolves a component name → component
 * node id; `implements_flow` resolves a file name → file node id (repo-scoped, global
 * name fallback); unresolvable edges are skipped. Idempotent: deletes its own prior
 * `flow` nodes (and their edges) before inserting. Advances the build to `dependencies`
 * and re-enqueues.
 *
 * When `deps.semantic` is absent (local/tests) the LLM step is skipped: no flows are
 * produced and the phase still advances + enqueues.
 */
export async function runFlows(deps: RunPhaseDeps, job: BuildJob): Promise<void> {
  const buildId = job.buildId;
  if (!buildId) {
    log.error({}, 'graph-builder: flows phase requires a buildId');
    return;
  }

  const db: Db = deps.db;

  try {
    // Idempotency: clear any prior flow output (flows + their touches/implements_flow edges).
    await deleteBuildNodesByKind(db, buildId, ['flow']);

    // Load the build's component nodes and its file nodes.
    const componentRows = (await nodesByKind(db, buildId, ['component']))
      .map((r) => ({ id: r.id, name: r.name, digest: r.digest, repoFullName: r.repoFullName ?? '' }));

    const fileRows = (await nodesByKind(db, buildId, ['file']))
      .map((r) => ({ id: r.id, name: r.name, repoFullName: r.repoFullName ?? '' }));

    // Resolution maps for file refs: repo-scoped + global name fallback.
    const fileIdByRepoName = new Map<string, string>();
    const fileIdByName = new Map<string, string>();
    for (const f of fileRows) {
      fileIdByRepoName.set(`${f.repoFullName}\n${f.name}`, f.id);
      fileIdByName.set(f.name, f.id);
    }

    // Resolution map for component names → component node id (for touches edges).
    const compIdByName = new Map(componentRows.map((c) => [c.name, c.id]));

    // composes edges (component → file) tell us which files belong to each component,
    // so we can summarise the component for the model.
    const composesRows = await edgesByRelation(db, buildId, 'composes');
    const fileById = new Map(fileRows.map((f) => [f.id, f]));
    const filesByComp = new Map<string, { id: string; name: string; repoFullName: string }[]>();
    for (const e of composesRows) {
      const file = fileById.get(e.dst);
      if (!file) continue;
      const list = filesByComp.get(e.src) ?? [];
      list.push(file);
      filesByComp.set(e.src, list);
    }

    // Without a semantic backend we cannot run the extractor; degrade (no flows).
    if (!deps.semantic) {
      await advance(deps, job, buildId);
      return;
    }

    const flowSkills = deps.skills.skillsFor('flows').filter((s) => s.promptFragment && s.parse);

    let components: ComponentUnit[] = componentRows
      .map((c) => ({
        id: c.id, name: c.name, digest: c.digest ?? null, repoFullName: c.repoFullName,
        files: filesByComp.get(c.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (components.length > MAX_COMPONENTS) {
      log.warn({ count: components.length, max: MAX_COMPONENTS, buildId }, `graph-builder: flows truncating components ${components.length} → ${MAX_COMPONENTS} (build ${buildId})`);
      components = components.slice(0, MAX_COMPONENTS);
    }

    // Fan out: one (or more) LLM call(s) per component, bounded concurrency.
    const semantic = deps.semantic;
    const perComponent = await mapBounded(components, FANOUT_CONCURRENCY, async (comp) => {
      const summaryLines = [
        `Component: ${comp.name}`,
        ...(comp.digest ? [`Description: ${comp.digest}`] : []),
        ...(comp.files.length ? ['Files:', ...comp.files.map((f) => `- ${f.name}`)] : []),
      ];
      const summary = summaryLines.join('\n');
      const contributions: { repoFullName: string; contribution: SkillContribution }[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      for (const skill of flowSkills) {
        const prompt = skill.promptFragment!({ summary, area: comp.name, repoFullName: comp.repoFullName });
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
          phase: 'flows',
          messages: [{ role: 'user', content: prompt }],
          output: res.text,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          status: 'ok',
        });
        const contribution = skill.parse!(res.text, { area: comp.name, repoFullName: comp.repoFullName });
        contributions.push({ repoFullName: comp.repoFullName, contribution });
      }
      return { contributions, inputTokens, outputTokens };
    });

    let tokens = 0;
    for (const r of perComponent) tokens += r.inputTokens + r.outputTokens;

    // Merge flows across components by name. A flow keeps one node; its touches +
    // implements_flow edges are unioned (deduped by resolved id). repoFullName is
    // single-repo when every contribution came from the same repo, else '(project)'.
    interface MergedFlow { name: string; digest: string | null; repos: Set<string>; compIds: Set<string>; fileIds: Set<string> }
    const merged = new Map<string, MergedFlow>();

    for (const r of perComponent) {
      for (const { repoFullName, contribution } of r.contributions) {
        // Index this contribution's flow → its declared touches/implements file refs.
        const touchesByFlow = new Map<string, string[]>();
        const filesByFlow = new Map<string, string[]>();
        for (const e of contribution.edges) {
          if (e.relation === 'touches') {
            const list = touchesByFlow.get(e.srcName) ?? []; list.push(e.dstName); touchesByFlow.set(e.srcName, list);
          } else if (e.relation === 'implements_flow') {
            const list = filesByFlow.get(e.srcName) ?? []; list.push(e.dstName); filesByFlow.set(e.srcName, list);
          }
        }

        for (const node of contribution.nodes) {
          if (node.kind !== 'flow') continue;
          let flow = merged.get(node.name);
          if (!flow) { flow = { name: node.name, digest: node.digest ?? null, repos: new Set(), compIds: new Set(), fileIds: new Set() }; merged.set(node.name, flow); }
          if (!flow.digest && node.digest) flow.digest = node.digest;
          flow.repos.add(repoFullName);

          // Resolve touches: flow → component name → component node id.
          for (const compName of touchesByFlow.get(node.name) ?? []) {
            const id = compIdByName.get(compName);
            if (id) flow.compIds.add(id);
          }
          // Resolve implements_flow: flow → file name → file node id (repo-scoped, global fallback).
          for (const fileRef of filesByFlow.get(node.name) ?? []) {
            const id = fileIdByRepoName.get(`${repoFullName}\n${fileRef}`) ?? fileIdByName.get(fileRef);
            if (id) flow.fileIds.add(id);
          }
        }
      }
    }

    // Persist merged flow nodes, then touches + implements_flow edges to resolved ids.
    const flowNodes: NewNode[] = [...merged.values()].map((f) => ({
      orgId: job.orgId,
      buildId,
      repoFullName: f.repos.size === 1 ? [...f.repos][0]! : '(project)',
      kind: 'flow',
      name: f.name,
      digest: f.digest,
    }));
    const inserted = await insertNodes(db, flowNodes);
    const flowIdByName = new Map(inserted.map((r) => [r.name, r.id]));

    const edgeRows: { orgId: string; buildId: string; srcNodeId: string; dstNodeId: string; relation: string }[] = [];
    for (const f of merged.values()) {
      const flowId = flowIdByName.get(f.name);
      if (!flowId) continue;
      for (const compId of f.compIds) {
        edgeRows.push({ orgId: job.orgId, buildId, srcNodeId: flowId, dstNodeId: compId, relation: 'touches' });
      }
      for (const fileId of f.fileIds) {
        edgeRows.push({ orgId: job.orgId, buildId, srcNodeId: flowId, dstNodeId: fileId, relation: 'implements_flow' });
      }
    }
    await insertEdges(db, edgeRows);

    await addBuildTokens(db, buildId, tokens);
    await advance(deps, job, buildId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await finishBuild(db, buildId, { status: 'error', error: msg }); } catch { /* DB unreachable */ }
  }
}

/** Advance the build to the `dependencies` phase and re-enqueue. */
async function advance(deps: RunPhaseDeps, job: BuildJob, buildId: string): Promise<void> {
  await setBuildPhase(deps.db, buildId, 'dependencies');
  await deps.kgPublisher.publish({
    orgId: job.orgId,
    projectId: job.projectId,
    repoFullName: job.repoFullName,
    ref: job.ref,
    mode: job.mode,
    buildId,
    operationId: job.operationId ?? undefined,
    phase: 'dependencies',
  });
}
