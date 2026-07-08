import type { Db, QueuedTurn } from '@intellilabs/core';
import { appendConversationMessage } from '@intellilabs/core';
import { getCreditBalanceCents } from '@intellilabs/billing';

/** Returns a predicate: true => block this turn because credit enforcement is on and the org's
 *  balance is empty. Inert when `enforced` is false. On block it posts a best-effort in-thread
 *  notice. Never throws (a billing error must never block a turn — caller treats a throw as false). */
export function makeCreditsExhausted(db: Db, opts: { enforced: boolean }): (turn: QueuedTurn) => Promise<boolean> {
  return async (turn: QueuedTurn): Promise<boolean> => {
    if (!opts.enforced || !turn.orgId) return false;
    if ((await getCreditBalanceCents(db, turn.orgId)) > 0) return false;
    await appendConversationMessage(db, {
      conversationId: turn.laneId,
      role: 'assistant',
      content: '⚠️ Out of AI credits for this workspace. Top up in Billing to continue.',
    }).catch(() => { /* best-effort notice */ });
    return true;
  };
}
