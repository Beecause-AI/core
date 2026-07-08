import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { toDoc } from '../store/codec.js';
import { incidentRollup } from './conversations.js';

export type StartRcaRunInput = {
  incidentConversationId: string;
};

export type StartRcaRunResult = { alreadyRunning: boolean };

/**
 * Single-flight start of an RCA run for an incident conversation.
 *
 * A team RCA *is* the incident conversation — there is no separate rca_runs
 * table and no `operations` row. The run is tracked purely by
 * `conversations.status`. A Firestore transaction over the conversation doc
 * serializes concurrent callers (optimistic retry replaces the per-conversation
 * advisory lock) so two of them can't both flip the conversation to
 * `investigating`. If it's already `investigating`, this is a no-op and we
 * report `alreadyRunning: true`.
 *
 * The run id, if a caller needs one, is the incidentConversationId itself.
 */
export async function startRcaRun(db: Db, input: StartRcaRunInput): Promise<StartRcaRunResult> {
  const ref = col(db, 'conversations').doc(input.incidentConversationId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && (snap.data()?.['status'] as string) === 'investigating') {
      return { alreadyRunning: true };
    }
    tx.update(ref, toDoc({ status: 'investigating' }));
    return { alreadyRunning: false };
  });
}

export type FinishRcaRunInput = {
  incidentConversationId: string;
  status: 'done' | 'failed';
};

/** Finish an RCA run: mark the incident conversation done. */
export async function finishRcaRun(db: Db, input: FinishRcaRunInput): Promise<void> {
  await col(db, 'conversations').doc(input.incidentConversationId).update(toDoc({ status: 'done' }));
}

/** Total cost (numeric string) over the incident root and its sub-agent children. */
export async function incidentCost(db: Db, incidentConversationId: string): Promise<string> {
  const roll = await incidentRollup(db, incidentConversationId);
  return roll.costUsd;
}
