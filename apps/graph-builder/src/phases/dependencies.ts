import {
  finishBuild,
  setBuildPhase,
  addBuildTokens,
  insertNodes,
  insertEdges,
  makeLogger,
  type Db,
  type NewNode,
} from '@intellilabs/core';

const log = makeLogger({ service: 'graph-builder', projectId: process.env.GCP_PROJECT_ID ?? 'local' });
import type { SkillContribution } from '@intellilabs/kg-skills';
import type { RunPhaseDeps } from '../run-phase.js';
import type { BuildJob } from '../app.js';
import { nodesByKind, deleteEdgesByRelation } from '../kg-store.js';

/** Cap on fan-out units (owners) we send to the LLM per build. */
const MAX_OWNERS = 48;
/** Bounded parallelism for owner LLM calls. */
const FANOUT_CONCURRENCY = 6;

/** Node kinds this phase may CREATE as new dependency/signal targets (deduped against the build). */
const TARGET_KINDS = ['datastore', 'external', 'metric', 'log', 'trace'];
/** Edge relations this phase OWNS (cleared for idempotency; node deletes are NOT done here). */
const OWNED_RELATIONS = ['depends_on', 'emits'];

/** Telemetry signal kinds. We only admit these when a detector confirmed the provider. */
const TELEMETRY_KINDS = new Set(['metric', 'log', 'trace']);

/** An owner (component or flow) the model maps dependencies/signals onto. */
interface OwnerUnit { id: string; name: string; kind: 'component' | 'flow'; digest: string | null; repoFullName: string }

/** Lowercase + trim a node name for case-insensitive (kind,name) keying. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Canonicalize an observability provider so LLM-named providers line up with the
 * detector-confirmed ones. Lowercases, strips spaces/hyphens/dots/underscores, then
 * maps common synonyms onto the canonical ids the structure-phase detectors emit
 * (`otel`, `cloud-ops`, `datadog`, `sentry`, `prometheus`, ...).
 */
function normalizeProvider(provider: string | null | undefined): string {
  if (!provider) return '';
  const stripped = provider.trim().toLowerCase().replace(/[\s\-._]/g, '');
  const SYNONYMS: Record<string, string> = {
    opentelemetry: 'otel',
    otel: 'otel',
    googlecloudoperations: 'cloud-ops',
    cloudoperations: 'cloud-ops',
    googlecloud: 'cloud-ops',
    gcp: 'cloud-ops',
    stackdriver: 'cloud-ops',
    cloudops: 'cloud-ops',
    datadog: 'datadog',
    ddog: 'datadog',
    pagerduty: 'pagerduty',
    sentry: 'sentry',
    prometheus: 'prometheus',
    prom: 'prometheus',
    elastic: 'elasticsearch',
    elasticsearch: 'elasticsearch',
    jaeger: 'jaeger',
    grafana: 'grafana',
  };
  return SYNONYMS[stripped] ?? stripped;
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
 * Phase 4 — dependencies (agentic, LLM-backed).
 *
 * Loads the build's component + flow nodes (the "owners") plus the structure phase's
 * detector candidates (datastore/external/signal nodes), then fans out one (or more)
 * `link-dependencies` LLM call per owner. The model maps each owner to its datastore/
 * external dependencies (`depends_on`) and emitted signals (`emits`), possibly naming
 * targets the detectors did not find. Owner names resolve to component/flow node ids;
 * target names resolve to an EXISTING build node of the same (kind, name) when present,
 * else a genuinely new node is created — so the structure phase's detector nodes are
 * reused, never duplicated.
 *
 * Idempotency: this phase owns `depends_on`/`emits` edges. Before inserting it deletes
 * those edges for the build (NOT the detector NODES from the structure phase), and
 * dedupes its target nodes by (kind, name) against the build's current
 * datastore/external/signal nodes — only genuinely new targets are inserted. Re-running
 * therefore yields no duplicate edges and no duplicate target nodes. Advances the build
 * to `finalize` and re-enqueues.
 *
 * When `deps.semantic` is absent (local/tests) the LLM step is skipped: no links are
 * produced and the phase still advances + enqueues.
 */
export async function runDependencies(deps: RunPhaseDeps, job: BuildJob): Promise<void> {
  const buildId = job.buildId;
  if (!buildId) {
    log.error({}, 'graph-builder: dependencies phase requires a buildId');
    return;
  }

  const db: Db = deps.db;

  try {
    // Idempotency (edges): clear this phase's OWN depends_on/emits edges for the build.
    // We deliberately do NOT delete detector target NODES — they belong to the structure
    // phase. New targets are deduped by (kind,name) below so re-runs add no node dupes.
    await deleteEdgesByRelation(db, buildId, [...OWNED_RELATIONS]);

    // Load owners (components + flows) and existing target candidates (the structure
    // detectors' datastore/external/signal nodes, plus any this phase created before).
    const ownerRows = (await nodesByKind(db, buildId, ['component', 'flow']))
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind, digest: r.digest, repoFullName: r.repoFullName ?? '' }));

    const targetRows = (await nodesByKind(db, buildId, [...TARGET_KINDS]))
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind, metadata: r.metadata }));

    // (kind, normalizeName(name)) → existing target node id, across the build
    // (detector + prior-phase). Case-insensitive so LLM casing reuses detector nodes.
    const existingByKey = new Map<string, string>();
    for (const t of targetRows) existingByKey.set(`${t.kind}\n${normalizeName(t.name)}`, t.id);

    // Providers the structure-phase detectors actually CONFIRMED: the normalized
    // metadata.provider over existing telemetry nodes (metric/log/trace). The mapper
    // may only attribute telemetry to one of these — anything else is fabricated.
    const detectedTelemetryProviders = new Set<string>();
    for (const t of targetRows) {
      if (!TELEMETRY_KINDS.has(t.kind)) continue;
      const provider = (t.metadata as Record<string, unknown> | null)?.['provider'];
      const norm = normalizeProvider(typeof provider === 'string' ? provider : null);
      if (norm) detectedTelemetryProviders.add(norm);
    }

    // Owner name → its node id (last-writer-wins; flow/component names rarely collide).
    const ownerIdByName = new Map<string, string>();
    for (const o of ownerRows) ownerIdByName.set(o.name, o.id);

    // Without a semantic backend we cannot run the mapper; degrade (no links).
    if (!deps.semantic) {
      await advance(deps, job, buildId);
      return;
    }

    const depSkills = deps.skills.skillsFor('dependencies').filter((s) => s.promptFragment && s.parse);

    let owners: OwnerUnit[] = ownerRows
      .map((o) => ({ id: o.id, name: o.name, kind: o.kind as 'component' | 'flow', digest: o.digest ?? null, repoFullName: o.repoFullName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (owners.length > MAX_OWNERS) {
      log.warn({ count: owners.length, max: MAX_OWNERS, buildId }, `graph-builder: dependencies truncating owners ${owners.length} → ${MAX_OWNERS} (build ${buildId})`);
      owners = owners.slice(0, MAX_OWNERS);
    }

    // A shared candidate summary so the model prefers reusing detected targets by name.
    // Telemetry candidates include their provider so the prompt can pin the allowlist.
    const candidateSummary = targetRows.length
      ? `\nKnown dependency/signal candidates:\n${targetRows.map((t) => {
          const provider = (t.metadata as Record<string, unknown> | null)?.['provider'];
          return `- ${t.kind}: ${t.name}${typeof provider === 'string' ? ` (provider: ${provider})` : ''}`;
        }).join('\n')}`
      : '';

    // The confirmed observability providers, passed to the prompt so its allowlist is
    // accurate (belt-and-suspenders; the persist step enforces the same rule).
    const detectedProviders = [...detectedTelemetryProviders].sort();

    // Fan out: one (or more) LLM call(s) per owner, bounded concurrency.
    const semantic = deps.semantic;
    const perOwner = await mapBounded(owners, FANOUT_CONCURRENCY, async (owner) => {
      const summary = [
        `${owner.kind === 'flow' ? 'Flow' : 'Component'}: ${owner.name}`,
        ...(owner.digest ? [`Description: ${owner.digest}`] : []),
        candidateSummary,
      ].join('\n');
      const contributions: SkillContribution[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      for (const skill of depSkills) {
        const prompt = skill.promptFragment!({ summary, area: owner.name, repoFullName: owner.repoFullName, detectedProviders });
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
          phase: 'dependencies',
          messages: [{ role: 'user', content: prompt }],
          output: res.text,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          status: 'ok',
        });
        contributions.push(skill.parse!(res.text, { area: owner.name, repoFullName: owner.repoFullName }));
      }
      return { contributions, inputTokens, outputTokens };
    });

    let tokens = 0;
    for (const r of perOwner) tokens += r.inputTokens + r.outputTokens;

    // GROUNDING: collect new target nodes (deduped by (kind,normalizeName) against
    // existing + within this run) and the depends_on/emits edges. Telemetry signals are
    // only admitted when their provider was detector-confirmed; otherwise they are
    // DROPPED (no node, no edge) so the mapper can't invent observability stacks.
    // LLM-named datastores/external deps that weren't detected are kept but flagged
    // `inferred:true`.
    interface PendingTarget { kind: string; name: string; metadata: Record<string, unknown> | null }
    const newTargets = new Map<string, PendingTarget>(); // key = kind\nnormalizeName(name)
    interface PendingEdge { ownerName: string; targetKey: string; relation: string }
    const pendingEdges: PendingEdge[] = [];
    const edgeSeen = new Set<string>();

    for (const r of perOwner) {
      for (const contribution of r.contributions) {
        // Index this contribution's target nodes by name → kind (+ metadata).
        const targetByName = new Map<string, { kind: string; metadata: Record<string, unknown> | null }>();
        for (const n of contribution.nodes) {
          targetByName.set(n.name, { kind: n.kind, metadata: (n.metadata as Record<string, unknown> | null) ?? null });
        }

        for (const e of contribution.edges) {
          if (e.relation !== 'depends_on' && e.relation !== 'emits') continue;
          // Resolve the target's kind from the contribution's node decl; skip if unknown.
          const target = targetByName.get(e.dstName);
          if (!target) continue;
          const targetKey = `${target.kind}\n${normalizeName(e.dstName)}`;
          const exists = existingByKey.has(targetKey) || newTargets.has(targetKey);

          if (TELEMETRY_KINDS.has(target.kind)) {
            // Telemetry: reuse if it matches an existing/queued node; else admit ONLY when
            // the provider is detector-confirmed; otherwise DROP (fabricated stack).
            if (!exists) {
              const provider = (target.metadata as Record<string, unknown> | null)?.['provider'];
              const norm = normalizeProvider(typeof provider === 'string' ? provider : null);
              if (!norm || !detectedTelemetryProviders.has(norm)) continue; // DROP node + edge
              newTargets.set(targetKey, { kind: target.kind, name: e.dstName, metadata: target.metadata });
            }
          } else {
            // datastore/external: reuse if matched; else create flagged `inferred:true`.
            if (!exists) {
              const provider = (target.metadata as Record<string, unknown> | null)?.['provider'];
              const metadata: Record<string, unknown> = typeof provider === 'string'
                ? { provider, inferred: true }
                : { inferred: true };
              newTargets.set(targetKey, { kind: target.kind, name: e.dstName, metadata });
            }
          }

          const edgeKey = `${e.srcName}\n${targetKey}\n${e.relation}`;
          if (edgeSeen.has(edgeKey)) continue;
          edgeSeen.add(edgeKey);
          pendingEdges.push({ ownerName: e.srcName, targetKey, relation: e.relation });
        }
      }
    }

    // Insert genuinely-new target nodes, then extend the (kind,normalizeName)→id map.
    const newTargetNodes: NewNode[] = [...newTargets.values()].map((t) => ({
      orgId: job.orgId,
      buildId,
      repoFullName: '(project)',
      kind: t.kind,
      name: t.name,
      metadata: t.metadata,
    }));
    const insertedTargets = await insertNodes(db, newTargetNodes);
    for (const row of insertedTargets) existingByKey.set(`${row.kind}\n${normalizeName(row.name)}`, row.id);

    // Resolve edges: owner name → owner id, target (kind,name) → target id; skip
    // unresolvable (e.g. a telemetry target that was dropped above).
    const edgeRows: { orgId: string; buildId: string; srcNodeId: string; dstNodeId: string; relation: string }[] = [];
    for (const e of pendingEdges) {
      const src = ownerIdByName.get(e.ownerName);
      const dst = existingByKey.get(e.targetKey);
      if (src && dst) {
        edgeRows.push({ orgId: job.orgId, buildId, srcNodeId: src, dstNodeId: dst, relation: e.relation });
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

/** Advance the build to the `finalize` phase and re-enqueue. */
async function advance(deps: RunPhaseDeps, job: BuildJob, buildId: string): Promise<void> {
  await setBuildPhase(deps.db, buildId, 'finalize');
  await deps.kgPublisher.publish({
    orgId: job.orgId,
    projectId: job.projectId,
    repoFullName: job.repoFullName,
    ref: job.ref,
    mode: job.mode,
    buildId,
    operationId: job.operationId ?? undefined,
    phase: 'finalize',
  });
}
