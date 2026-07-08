import {
  appendConversationMessage,
  getTeamsRootTarget,
  teamsReplyText,
  makeLogger,
  type Db,
  type TeamsClient,
  type TeamsAuth,
  type QueuedTurn,
} from '@intellilabs/core';
import type { ModelEvent } from '@intellilabs/engine';

const log = makeLogger({ service: 'engine-worker', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

type TeamsPayload = { teams?: { serviceUrl: string; conversationId: string; placeholderActivityId: string; tenantId: string } };
export type TeamsDeliveryDeps = { db: Db; client: TeamsClient; auth: TeamsAuth };

/** Returns an EngineDeps.onEvent: for teams turns, on `done` persist the turn's authoritative
 *  answer (computed by the loop) and edit the placeholder into the final reply. Intermediate
 *  events produce NO status edit — the placeholder stays "💭 thinking…" until the final reply
 *  (no "Using …" / "Delegating to …" churn). No per-org token resolution: uses deps.auth (global creds). */
export function makeTeamsOnEvent(deps: TeamsDeliveryDeps) {
  return async function onEvent(turn: QueuedTurn, ev: ModelEvent): Promise<void> {
    if (turn.source !== 'teams') return;
    const teams = (turn.payload as TeamsPayload)?.teams;
    if (!teams) return;
    if (ev.type !== 'done') return; // intermediate events never edit the placeholder

    const md = ev.answer?.trim() || '(no response)';
    await appendConversationMessage(deps.db, { conversationId: turn.laneId, role: 'assistant', content: md });
    await deps.client.updateActivity(deps.auth, {
      serviceUrl: teams.serviceUrl,
      conversationId: teams.conversationId,
      activityId: teams.placeholderActivityId,
      text: teamsReplyText(md),
    });
  };
}

/** A short, human one-liner for the underlying error — drops any trailing JSON blob
 *  (e.g. `gemini 400: {…}` → `gemini 400`) and caps the length. */
function shortError(err: { name?: string; message?: string }): string {
  const m = (err.message ?? err.name ?? 'unknown error').toString();
  const cut = (m.split(/\s*[:{]/)[0] ?? m).trim() || m;
  return cut.slice(0, 200);
}

/** Report a FAILED turn to the originating Teams conversation, gracefully and classified.
 *  Works for nested internal sub-agent turns too: the root Teams conversation is resolved from the
 *  conversation tree. Retryable failures (rate limits / transient) ask the user to try again;
 *  permanent ones surface a simple error and point at an admin. Every failure is logged with
 *  structured context for tracking. Cancellations are intentional → no message. */
export async function deliverTeamsError(deps: TeamsDeliveryDeps, turn: QueuedTurn): Promise<void> {
  if (turn.status === 'cancelled') return;
  const target = await getTeamsRootTarget(deps.db, turn.laneId);
  if (!target?.serviceUrl) return;

  const err = (turn.error ?? {}) as { class?: string; name?: string; message?: string };
  const retryable = err.class === 'temporary';
  const text = retryable
    ? "⚠️ We're a bit overloaded right now and couldn't finish this — please try again in a moment (just @-mention us again)."
    : `⚠️ Something went wrong while we were working on this: \`${shortError(err)}\`. This looks like a bug — please reach out to an admin.`;

  log.error({
    tenant: target.tenantId,
    conversation: target.conversationId,
    failedTurn: turn.id,
    errorClass: err.class ?? 'unknown',
    retryable,
  }, 'teams-error');

  if (target.placeholderActivityId) {
    await deps.client.updateActivity(deps.auth, {
      serviceUrl: target.serviceUrl,
      conversationId: target.conversationId,
      activityId: target.placeholderActivityId,
      text,
    }).catch(() => {});
  } else {
    await deps.client.sendActivity(deps.auth, {
      serviceUrl: target.serviceUrl,
      conversationId: target.conversationId,
      text,
    }).catch(() => {});
  }
}
