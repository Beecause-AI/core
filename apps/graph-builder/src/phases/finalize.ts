import {
  finishBuild,
  finishOperation,
  insertEmbeddings,
  deleteBuildEmbeddings,
  makeLogger,
  type Db,
} from '@intellilabs/core';

const log = makeLogger({ service: 'graph-builder', projectId: process.env.GCP_PROJECT_ID ?? 'local' });
import type { RunPhaseDeps } from '../run-phase.js';
import type { BuildJob } from '../app.js';
import { nodesByKind, countNodes, buildTokens } from '../kg-store.js';

/**
 * Phase 5 — finalize (terminal).
 *
 * Embeds the build's `component` + `flow` nodes using the semantic backend (when
 * available), counts all nodes for the build, then marks the build as `done`.
 *
 * Idempotent: deletes existing embeddings for the build before re-inserting, so a
 * redelivered finalize message never causes a PK conflict. When `deps.semantic` is
 * absent (local/tests) embeddings are skipped but the build is still marked done.
 *
 * This phase is terminal — it does NOT advance the phase or re-enqueue.
 */
export async function runFinalize(deps: RunPhaseDeps, job: BuildJob): Promise<void> {
  const buildId = job.buildId;
  if (!buildId) {
    log.error({}, 'graph-builder: finalize phase requires a buildId');
    return;
  }

  const db: Db = deps.db;

  try {
    // Idempotency: delete prior embeddings for this build before re-inserting.
    await deleteBuildEmbeddings(deps.store, buildId);

    // Load component + flow nodes for embedding.
    const nodes = await nodesByKind(db, buildId, ['component', 'flow']);

    // Embed if semantic is available and there are nodes to embed.
    if (deps.semantic && nodes.length > 0) {
      const texts = nodes.map((n) => `${n.businessFlow ?? n.name}\n${n.digest ?? ''}`);
      const embeddings = await deps.semantic.embed(job.orgId, texts);
      await deps.recordInvocation?.({
        source: 'embedding',
        orgId: job.orgId,
        model: 'text-embedding-004',
        provider: 'google-vertex',
        buildId: job.buildId ?? null,
        operationId: job.operationId ?? null,
        phase: 'finalize',
        messages: { count: texts.length },
        output: '',
        inputTokens: 0,
        outputTokens: 0,
        status: 'ok',
      });
      const rows = nodes
        .map((n, i) => ({ nodeId: n.id, buildId, embedding: embeddings[i]! }))
        .filter((r) => r.embedding?.length);
      await insertEmbeddings(deps.store, rows);
    }

    // Count ALL nodes in the build for nodesAnalyzed.
    const nodesAnalyzed = await countNodes(db, buildId);

    await finishBuild(db, buildId, { status: 'done', nodesAnalyzed, note: null });

    // Close the wrapping operation with the build's running totals. The build tracks a
    // single combined `tokens` count (no input/output split, no $ cost), so we surface it
    // as inputTokens and leave outputTokens/costUsd null rather than invent an accounting
    // split. Best-effort: a telemetry close must never fail the build.
    if (job.operationId) {
      try {
        const tokens = await buildTokens(db, buildId);
        await finishOperation(db, job.operationId, {
          status: 'done',
          costUsd: null,
          inputTokens: tokens,
          outputTokens: null,
        });
      } catch { /* DB unreachable */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await finishBuild(db, buildId, { status: 'error', error: msg }); } catch { /* DB unreachable */ }
    if (job.operationId) {
      try { await finishOperation(db, job.operationId, { status: 'failed', costUsd: null }); } catch { /* DB unreachable */ }
    }
  }
}
