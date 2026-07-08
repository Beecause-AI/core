import { appendConversationMessage, type Db, type QueuedTurn } from '@intellilabs/core';
import type { ModelEvent } from '@intellilabs/engine';

/** onEvent for source:'internal' turns (sub-agent children): on done, persist the turn's
 *  authoritative answer (the agent's last non-empty assistant text, computed by the loop) to
 *  the (child) conversation so the parent-resume hook can read it via listConversationMessages. */
export function makeInternalOnEvent(db: Db) {
  return async function onEvent(turn: QueuedTurn, ev: ModelEvent): Promise<void> {
    if (turn.source !== 'internal') return;
    if (ev.type !== 'done') return;
    const text = ev.answer?.trim() || '(no response)';
    await appendConversationMessage(db, { conversationId: turn.laneId, role: 'assistant', content: text });
  };
}
