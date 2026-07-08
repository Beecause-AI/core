import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import { chunk } from '../store/query.js';
import type { AgentRun } from '../store/types.js';

/** Record one delegated call's result on the bridge (additive object merge — order-independent).
 *  The sequential fan-out accumulates here until every pending call has a result. */
export async function recordAgentRunResult(
  db: Db, runId: string, callId: string, result: string, childConversationId?: string,
): Promise<void> {
  const entry = { result, ...(childConversationId ? { childConversationId } : {}) };
  // Postgres `results || {callId:entry}::jsonb` → a single-key nested merge: update results.<callId>.
  await col(db, 'agent_runs').doc(runId).update({ [`results.${callId}`]: entry });
}

/** Suspended sub-agent bridges across a set of lanes — i.e. conversations parked waiting on a
 *  delegated child (a2a). Surfaces in-flight delegations on the live run view. */
export async function listSuspendedRuns(db: Db, laneIds: string[]): Promise<AgentRun[]> {
  if (laneIds.length === 0) return [];
  const out: AgentRun[] = [];
  for (const ids of chunk(laneIds, 30)) {
    const snaps = await col(db, 'agent_runs')
      .where('laneId', 'in', ids)
      .where('status', '==', 'suspended')
      .get();
    for (const d of snaps) out.push(fromDoc<AgentRun>(d));
  }
  return out;
}

export interface NewAgentRun {
  turnId: string;
  laneId: string;
  orgId: string;
  messages: unknown;
  pendingCalls: unknown;
  model: string;
  enabledTools: string[];
  slack?: unknown;
  otelTraceId?: string | null;
  /** Nesting depth of the sub-agent chain (0 = top-level). */
  depth?: number;
}

export async function createAgentRun(db: Db, input: NewAgentRun): Promise<AgentRun> {
  const ref = col(db, 'agent_runs').doc();
  const row = applyDefaults(
    {
      turnId: input.turnId,
      laneId: input.laneId,
      orgId: input.orgId,
      status: 'suspended',
      messages: input.messages,
      pendingCalls: input.pendingCalls,
      results: {} as Record<string, { result: string; childConversationId?: string }>,
      model: input.model,
      enabledTools: input.enabledTools,
      slack: input.slack ?? null,
      otelTraceId: input.otelTraceId ?? null,
      depth: input.depth ?? 0,
      approvedBy: null as string | null,
      resolvedAt: null as Date | null,
    },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<AgentRun>(await ref.get());
}

export async function getAgentRun(db: Db, id: string): Promise<AgentRun | undefined> {
  const snap = await col(db, 'agent_runs').doc(id).get();
  return snap.exists ? fromDoc<AgentRun>(snap) : undefined;
}

/** Atomically transition a suspended run to a resolved status. Returns true iff THIS call
 *  performed the transition (the run was 'suspended'); false if it was already resolved
 *  (lost the race / double-click). */
export async function resolveAgentRunIfSuspended(
  db: Db,
  id: string,
  r: { status: 'approved' | 'denied' | 'resolved'; approvedBy?: string },
): Promise<boolean> {
  const ref = col(db, 'agent_runs').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || (snap.data()?.['status'] as string) !== 'suspended') return false;
    tx.update(ref, toDoc({ status: r.status, approvedBy: r.approvedBy ?? null, resolvedAt: new Date() }));
    return true;
  });
}

export async function markAgentRunResolved(
  db: Db,
  id: string,
  r: { status: 'approved' | 'denied' | 'resolved'; approvedBy?: string },
): Promise<void> {
  await col(db, 'agent_runs').doc(id).update(toDoc({
    status: r.status,
    approvedBy: r.approvedBy ?? null,
    resolvedAt: new Date(),
  }));
}
