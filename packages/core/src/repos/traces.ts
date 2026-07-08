import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { Trace, TraceStep } from '../store/types.js';

const STEP_CAP = 1_000_000; // ~1 MB per tool payload field, matching model_invocations
const cap = (s: string | null | undefined): { value: string | null; truncated: boolean } => {
  if (s == null) return { value: null, truncated: false };
  return s.length > STEP_CAP ? { value: s.slice(0, STEP_CAP), truncated: true } : { value: s, truncated: false };
};

/** Format a cost like Postgres numeric(12,6): fixed 6-decimal string. The old Drizzle rows returned
 *  these numeric columns as strings (e.g. 0.0001 → '0.000100'); preserve that exact shape. */
const numeric6 = (n: number): string => n.toFixed(6);

export interface NewTrace {
  orgId: string;
  conversationId?: string | null;
  turnId?: string | null;
  source?: string;
  otelTraceId?: string | null;
}

export async function createTrace(db: Db, input: NewTrace): Promise<Trace> {
  const ref = col(db, 'traces').doc();
  const row = applyDefaults(
    {
      orgId: input.orgId,
      conversationId: input.conversationId ?? null,
      turnId: input.turnId ?? null,
      source: input.source ?? 'internal',
      status: 'running',
      startedAt: new Date(),
      endedAt: null as Date | null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: '0',
      modelCallCount: 0,
      toolCallCount: 0,
      otelTraceId: input.otelTraceId ?? null,
    },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<Trace>(await ref.get());
}

export interface NewTraceStep {
  traceId: string;
  type: 'model_call' | 'tool_call';
  name: string;
  status: 'ok' | 'error';
  startedAt: Date;
  endedAt: Date;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  error?: string | null;
  argsPreview?: string | null;
  resultPreview?: string | null;
  args?: string | null;
  result?: string | null;
  childConversationId?: string | null;
}

export async function addTraceStep(db: Db, input: NewTraceStep): Promise<TraceStep> {
  const a = cap(input.args);
  const r = cap(input.result);
  const ref = col(db, 'trace_steps').doc();
  const row = applyDefaults(
    {
      traceId: input.traceId,
      type: input.type,
      name: input.name,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      latencyMs: input.latencyMs,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      costUsd: input.costUsd != null ? numeric6(input.costUsd) : null,
      error: input.error ?? null,
      argsPreview: input.argsPreview ?? null,
      resultPreview: input.resultPreview ?? null,
      args: a.value,
      result: r.value,
      truncated: a.truncated || r.truncated,
      childConversationId: input.childConversationId ?? null,
    },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<TraceStep>(await ref.get());
}

/** Insert an in-flight ('running') trace step BEFORE the call runs (so it shows live). Returns the
 *  row id, or null if the write failed (caller then writes the full step at finish). Best-effort. */
export async function startTraceStep(
  db: Db, input: { traceId: string; type: 'model_call' | 'tool_call'; name: string; startedAt: Date },
): Promise<string | null> {
  try {
    const ref = col(db, 'trace_steps').doc();
    const row = applyDefaults(
      {
        traceId: input.traceId, type: input.type, name: input.name, status: 'running', startedAt: input.startedAt,
        truncated: false,
      },
      ref.id,
    );
    await ref.set(toDoc(row));
    return ref.id;
  } catch {
    return null;
  }
}

/** Complete a trace step started by startTraceStep. */
export async function finishTraceStep(
  db: Db, id: string,
  input: {
    status: 'ok' | 'error'; endedAt: Date; latencyMs: number;
    inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null; error?: string | null;
    argsPreview?: string | null; resultPreview?: string | null; args?: string | null; result?: string | null;
    childConversationId?: string | null;
  },
): Promise<void> {
  const a = cap(input.args);
  const r = cap(input.result);
  await col(db, 'trace_steps').doc(id).update(toDoc({
    status: input.status,
    endedAt: input.endedAt,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    costUsd: input.costUsd != null ? numeric6(input.costUsd) : null,
    error: input.error ?? null,
    argsPreview: input.argsPreview ?? null,
    resultPreview: input.resultPreview ?? null,
    args: a.value,
    result: r.value,
    truncated: a.truncated || r.truncated,
    childConversationId: input.childConversationId ?? null,
  }));
}

export interface TraceRollup {
  status: 'ok' | 'error' | 'cancelled';
  endedAt: Date;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  modelCallCount: number;
  toolCallCount: number;
  otelTraceId?: string | null;
}

export async function finalizeTrace(db: Db, traceId: string, r: TraceRollup): Promise<void> {
  await col(db, 'traces').doc(traceId).update(toDoc({
    status: r.status,
    endedAt: r.endedAt,
    totalInputTokens: r.totalInputTokens,
    totalOutputTokens: r.totalOutputTokens,
    totalCostUsd: numeric6(r.totalCostUsd),
    modelCallCount: r.modelCallCount,
    toolCallCount: r.toolCallCount,
    ...(r.otelTraceId !== undefined ? { otelTraceId: r.otelTraceId } : {}),
  }));
}

export async function listTraceSteps(db: Db, traceId: string): Promise<TraceStep[]> {
  const snaps = await col(db, 'trace_steps').where('traceId', '==', traceId).get();
  return snaps.map((d) => fromDoc<TraceStep>(d));
}

export async function getTrace(db: Db, id: string): Promise<Trace | undefined> {
  const snap = await col(db, 'traces').doc(id).get();
  return snap.exists ? fromDoc<Trace>(snap) : undefined;
}

export async function listTracesByConversationId(db: Db, conversationId: string): Promise<Trace[]> {
  const snaps = await col(db, 'traces')
    .where('conversationId', '==', conversationId)
    .orderBy('startedAt', 'asc')
    .get();
  return snaps.map((d) => fromDoc<Trace>(d));
}
