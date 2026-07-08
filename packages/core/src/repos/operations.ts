import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { Snapshot } from '../ports/store.js';
import type { Operation } from '../store/types.js';

export type StartOperationInput = {
  orgId: string; kind: string; projectId?: string | null;
  parentConversationId?: string | null; refId?: string | null;
};

/** numeric(cost_usd) round-trips as a STRING in the old Drizzle rows; Firestore stores it as a
 *  number so the incidentRollup sum() aggregate works. Normalise the read back to string|null. */
function readOperation(snap: Snapshot): Operation {
  const row = fromDoc<Operation & { costUsd: number | string | null }>(snap);
  return { ...row, costUsd: row.costUsd == null ? null : String(row.costUsd) };
}

export async function startOperation(db: Db, input: StartOperationInput): Promise<Operation> {
  const ref = col(db, 'operations').doc();
  const row = applyDefaults(
    {
      orgId: input.orgId, kind: input.kind,
      projectId: input.projectId ?? null,
      parentConversationId: input.parentConversationId ?? null,
      runConversationId: null as string | null,
      refId: input.refId ?? null,
      status: 'running',
      costUsd: null as number | null,
      inputTokens: null as number | null,
      outputTokens: null as number | null,
      error: null as string | null,
      startedAt: new Date(),
      finishedAt: null as Date | null,
    },
    ref.id,
  );
  await ref.set(toDoc(row));
  return readOperation(await ref.get());
}

/** Reuse the most recent operation for the same (kind, refId) — flipping it back to running and
 *  clearing finishedAt — so redeliveries of one job link their attempts under ONE operation row.
 *  refId is required for reuse; if refId is null, always insert a fresh operation. */
export async function startOrReuseOperation(db: Db, input: StartOperationInput): Promise<Operation> {
  if (input.refId) {
    const existing = await col(db, 'operations')
      .where('kind', '==', input.kind)
      .where('refId', '==', input.refId)
      .orderBy('startedAt', 'desc')
      .limit(1)
      .get();
    const found = existing[0];
    if (found) {
      const foundRef = col(db, 'operations').doc(found.id);
      await foundRef.update(toDoc({ status: 'running', finishedAt: null }));
      return readOperation(await foundRef.get());
    }
  }
  return startOperation(db, input);
}

export async function finishOperation(
  db: Db, id: string,
  totals: { status: 'done' | 'failed'; costUsd?: string | null; inputTokens?: number | null; outputTokens?: number | null; error?: string | null },
): Promise<void> {
  await col(db, 'operations').doc(id).update(toDoc({
    status: totals.status,
    // numeric stored as a Firestore number so incidentRollup sum() works; null when absent.
    costUsd: totals.costUsd != null ? Number(totals.costUsd) : null,
    inputTokens: totals.inputTokens ?? null,
    outputTokens: totals.outputTokens ?? null,
    error: totals.error ?? null,
    finishedAt: FieldValue.serverTimestamp(),
  }));
}

export async function getOperation(db: Db, id: string): Promise<Operation | null> {
  const snap = await col(db, 'operations').doc(id).get();
  return snap.exists ? readOperation(snap) : null;
}

/** Link an operation to the conversation it RAN — e.g. the agentic team-gen analysis tree — so the
 *  operation's run timeline can surface that conversation. Uses run_conversation_id (NOT
 *  parent_conversation_id), so the operation stays a top-level row in the activity feed. */
export async function setOperationConversation(db: Db, id: string, conversationId: string): Promise<void> {
  await col(db, 'operations').doc(id).update(toDoc({ runConversationId: conversationId }));
}
