import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import { chunk } from '../store/query.js';
import type { Query, Snapshot } from '../ports/store.js';
import type { ModelInvocation } from '../store/types.js';
import type { InvocationCostHook } from '../ports/billing-hook.js';

const CAP = 1_000_000; // ~1 MB per payload field

/** Cap a messages array to ~1 MB (serialised), replacing with a marker if oversized. */
function capMessages(messages: unknown): { messages: unknown[] | null; truncated: boolean } {
  if (messages == null) return { messages: null, truncated: false };
  const str = JSON.stringify(messages);
  if (str.length > CAP) return { messages: [{ role: 'system', content: `[truncated ${str.length} bytes]` }], truncated: true };
  return { messages: messages as unknown[], truncated: false };
}

/** `cost_usd` is a Postgres numeric → the old Drizzle rows returned it as a STRING. Firestore stores
 *  it as a NUMBER so `incidentRollup`'s sum() aggregate (in conversations.ts) can sum it directly.
 *  On read we normalise back to string|null so callers see the same row type as before. */
function readFull(snap: Snapshot): ModelInvocation {
  const row = fromDoc<Omit<ModelInvocation, 'costUsd'> & { costUsd: number | string | null }>(snap);
  return { ...row, costUsd: row.costUsd == null ? null : String(row.costUsd) };
}

/** Input shape: all cols except id / createdAt / truncated; messages is untyped. */
export type NewModelInvocationInput = {
  orgId?: string | null;
  source: string;
  model: string;
  provider?: string | null;
  conversationId?: string | null;
  buildId?: string | null;
  operationId?: string | null;
  phase?: string | null;
  messages?: unknown;
  output?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: string | null;
  latencyMs?: number | null;
  status: string;
  error?: string | null;
  rateLimited?: boolean;
};

/** Compact list row — excludes the large payload fields. */
export type CompactInvocationRow = Pick<
  ModelInvocation,
  | 'id'
  | 'createdAt'
  | 'source'
  | 'model'
  | 'provider'
  | 'orgId'
  | 'conversationId'
  | 'buildId'
  | 'operationId'
  | 'phase'
  | 'inputTokens'
  | 'outputTokens'
  | 'costUsd'
  | 'latencyMs'
  | 'status'
>;

function toCompact(row: ModelInvocation): CompactInvocationRow {
  return {
    id: row.id,
    createdAt: row.createdAt,
    source: row.source,
    model: row.model,
    provider: row.provider,
    orgId: row.orgId,
    conversationId: row.conversationId,
    buildId: row.buildId,
    operationId: row.operationId,
    phase: row.phase,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    latencyMs: row.latencyMs,
    status: row.status,
  };
}

/** Build the row to persist. costUsd kept as a NUMBER for the rollup sum() aggregate. */
function buildRow(
  row: NewModelInvocationInput | StartModelInvocationInput,
  extra: { messages: unknown[] | null; output: string | null; status: string; inputTokens: number | null; outputTokens: number | null; costUsd: string | null; latencyMs: number | null; error: string | null; truncated: boolean },
) {
  return {
    orgId: row.orgId ?? null,
    source: row.source,
    model: row.model,
    provider: row.provider ?? null,
    conversationId: row.conversationId ?? null,
    buildId: row.buildId ?? null,
    operationId: row.operationId ?? null,
    phase: row.phase ?? null,
    messages: extra.messages,
    output: extra.output,
    inputTokens: extra.inputTokens,
    outputTokens: extra.outputTokens,
    costUsd: extra.costUsd != null ? Number(extra.costUsd) : null,
    latencyMs: extra.latencyMs,
    status: extra.status,
    error: extra.error,
    rateLimited: 'rateLimited' in row ? (row.rateLimited ?? false) : false,
    truncated: extra.truncated,
  };
}

/**
 * Best-effort telemetry recorder. Any error is swallowed so the call path is
 * never broken by failed logging.
 */
export async function recordModelInvocation(
  db: Db,
  row: NewModelInvocationInput,
  opts?: { onCost?: InvocationCostHook },
): Promise<void> {
  try {
    let messages = row.messages as unknown[] | undefined | null;
    let output = row.output ?? null;
    let truncated = false;

    const msgStr = messages == null ? null : JSON.stringify(messages);
    if (msgStr != null && msgStr.length > CAP) {
      messages = [{ role: 'system', content: `[truncated ${msgStr.length} bytes]` }];
      truncated = true;
    }
    if (output != null && output.length > CAP) {
      output = output.slice(0, CAP);
      truncated = true;
    }

    const ref = col(db, 'model_invocations').doc();
    const doc = applyDefaults(
      buildRow(row, {
        messages: messages ?? null,
        output,
        inputTokens: row.inputTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        costUsd: row.costUsd ?? null,
        latencyMs: row.latencyMs ?? null,
        status: row.status,
        error: row.error ?? null,
        truncated,
      }),
      ref.id,
    );
    await ref.set(toDoc(doc));
    if (row.conversationId && row.orgId && row.costUsd != null && opts?.onCost) {
      await opts.onCost({ orgId: row.orgId, costUsd: Number(row.costUsd), conversationId: row.conversationId, modelInvocationId: ref.id });
    }
  } catch {
    // best-effort: telemetry must never break the call path
  }
}

/** Input for an in-flight ('running') invocation row written BEFORE the model call. */
export type StartModelInvocationInput = {
  orgId?: string | null;
  source: string;
  model: string;
  provider?: string | null;
  conversationId?: string | null;
  buildId?: string | null;
  operationId?: string | null;
  phase?: string | null;
  messages?: unknown;
};

/** Insert an in-flight invocation (status 'running', messages set, output/tokens null) BEFORE the
 *  call so it shows live. Returns the row id (or null if the write failed — caller then inserts a
 *  full row at finish). Best-effort. */
export async function startModelInvocation(db: Db, row: StartModelInvocationInput): Promise<string | null> {
  try {
    const { messages, truncated } = capMessages(row.messages);
    const ref = col(db, 'model_invocations').doc();
    const doc = applyDefaults(
      buildRow(row, {
        messages: messages ?? null,
        output: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        latencyMs: null,
        status: 'running',
        error: null,
        truncated,
      }),
      ref.id,
    );
    await ref.set(toDoc(doc));
    return ref.id;
  } catch {
    return null;
  }
}

/** Complete an in-flight invocation row started by startModelInvocation. Best-effort. */
export async function finishModelInvocation(
  db: Db, id: string,
  result: { output?: string | null; inputTokens?: number | null; outputTokens?: number | null; costUsd?: string | null; latencyMs?: number | null; status: string; error?: string | null; rateLimited?: boolean },
  opts?: { onCost?: InvocationCostHook },
): Promise<void> {
  try {
    let output = result.output ?? null;
    let truncated = false;
    if (output != null && output.length > CAP) { output = output.slice(0, CAP); truncated = true; }
    await col(db, 'model_invocations').doc(id).update(toDoc({
      output,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      costUsd: result.costUsd != null ? Number(result.costUsd) : null,
      latencyMs: result.latencyMs ?? null,
      status: result.status,
      error: result.error ?? null,
      rateLimited: result.rateLimited ?? false,
      ...(truncated ? { truncated: true } : {}),
    }));
    const cost = result.costUsd != null ? Number(result.costUsd) : 0;
    if (cost > 0 && opts?.onCost) {
      const snap = await col(db, 'model_invocations').doc(id).get();
      const d = snap.data() as ({ orgId?: string | null; conversationId?: string | null } | undefined);
      if (d?.conversationId && d?.orgId) {
        await opts.onCost({ orgId: d.orgId, costUsd: cost, conversationId: d.conversationId, modelInvocationId: id });
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * List invocations — compact rows only (no messages / output).
 * Supports filtering by source, model, orgId and a `before` cursor (createdAt).
 */
export async function listModelInvocations(
  db: Db,
  opts: {
    source?: string;
    model?: string;
    orgId?: string;
    before?: Date;
    limit?: number;
    conversationIds?: string[];
    operationId?: string;
  } = {},
): Promise<CompactInvocationRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);

  // An empty conversationIds filter matches nothing (mirrors inArray([])).
  if (opts.conversationIds != null && opts.conversationIds.length === 0) return [];

  const applyFilters = (ids?: string[]) => {
    let q: Query = col(db, 'model_invocations');
    if (opts.source != null) q = q.where('source', '==', opts.source);
    if (opts.model != null) q = q.where('model', '==', opts.model);
    if (opts.orgId != null) q = q.where('orgId', '==', opts.orgId);
    if (opts.operationId != null) q = q.where('operationId', '==', opts.operationId);
    if (ids != null) q = q.where('conversationId', 'in', ids);
    if (opts.before != null) q = q.where('createdAt', '<', opts.before);
    return q.orderBy('createdAt', 'desc').limit(limit);
  };

  let rows: ModelInvocation[];
  if (opts.conversationIds != null && opts.conversationIds.length > 0) {
    // `in` is capped at 30 values — chunk, query each chunk, merge then re-sort/limit.
    const merged: ModelInvocation[] = [];
    for (const ids of chunk(opts.conversationIds, 30)) {
      const snaps = await applyFilters(ids).get();
      for (const d of snaps) merged.push(readFull(d));
    }
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    rows = merged.slice(0, limit);
  } else {
    const snaps = await applyFilters().get();
    rows = snaps.map((d) => readFull(d));
  }
  return rows.map(toCompact);
}

/** Full invocation rows (incl. messages/output) for a single operation OR a set of
 *  conversations, oldest-first. Bounded by `limit` (caller logs if it caps). */
export async function listFullModelInvocations(
  db: Db,
  opts: { operationId?: string; conversationIds?: string[]; limit?: number },
): Promise<ModelInvocation[]> {
  const limit = Math.min(opts.limit ?? 500, 1000);
  if (opts.conversationIds != null && opts.conversationIds.length === 0) return [];

  if (opts.conversationIds != null && opts.conversationIds.length > 0) {
    const merged: ModelInvocation[] = [];
    for (const ids of chunk(opts.conversationIds, 30)) {
      let q: Query = col(db, 'model_invocations').where('conversationId', 'in', ids);
      if (opts.operationId != null) q = q.where('operationId', '==', opts.operationId);
      const snaps = await q.orderBy('createdAt', 'asc').limit(limit).get();
      for (const d of snaps) merged.push(readFull(d));
    }
    merged.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return merged.slice(0, limit);
  }

  let q: Query = col(db, 'model_invocations');
  if (opts.operationId != null) q = q.where('operationId', '==', opts.operationId);
  const snaps = await q.orderBy('createdAt', 'asc').limit(limit).get();
  return snaps.map((d) => readFull(d));
}

/** Fetch a single invocation by id (full row including messages / output). */
export async function getModelInvocation(
  db: Db,
  id: string,
): Promise<ModelInvocation | null> {
  const snap = await col(db, 'model_invocations').doc(id).get();
  return snap.exists ? readFull(snap) : null;
}
