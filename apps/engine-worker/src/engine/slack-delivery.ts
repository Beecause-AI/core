import {
  appendConversationMessage,
  getIntegration,
  getSlackRootTarget,
  getUnpostedOfferForConversation,
  setCopilotIssueOfferMessageTs,
  renderCopilotOfferMessage,
  getUnpostedReportOfferForConversation,
  setReportOfferMessageTs,
  decryptSecret,
  markdownToBlocks,
  markdownToFallbackText,
  makeLogger,
  type Db,
  type SlackClient,
  type QueuedTurn,
} from '@intellilabs/core';
import type { ModelEvent } from '@intellilabs/engine';

const log = makeLogger({ service: 'engine-worker', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

type SlackPayload = { slack?: { channel: string; threadTs: string; placeholderTs: string }; projectId?: string };
type DeliveryDeps = { db: Db; secretsKey: () => Buffer; client: SlackClient };

/** Resolve the decrypted Slack bot token for an org, or null if not connected. */
async function resolveSlackToken(deps: DeliveryDeps, orgId: string): Promise<string | null> {
  const conn = await getIntegration(deps.db, orgId, 'slack');
  if (!conn?.secretCiphertext) return null;
  return decryptSecret(conn.secretCiphertext, deps.secretsKey());
}

/** Edit an existing Slack message in place (e.g. the report offer's "Generating…" message into the
 *  finished report link). No-op when the org has no Slack token. Used by the report-gen consumer. */
export async function updateSlackMessage(
  deps: DeliveryDeps,
  orgId: string,
  channel: string,
  ts: string,
  text: string,
): Promise<void> {
  const token = await resolveSlackToken(deps, orgId);
  if (!token) return;
  await deps.client.chatUpdate(token, { channel, ts, text });
}

/** Returns an EngineDeps.onEvent: for slack turns, on `done` persist the turn's authoritative
 *  answer (computed by the loop) and edit the placeholder into the final reply. Intermediate
 *  events produce NO status edit — the placeholder stays "💭 thinking…" until the final reply
 *  (no "Using …" / "Delegating to …" churn). */
export function makeSlackOnEvent(deps: DeliveryDeps) {
  async function editPlaceholder(
    turn: QueuedTurn,
    slack: NonNullable<SlackPayload['slack']>,
    text: string,
    blocks?: unknown[],
  ): Promise<void> {
    const token = await resolveSlackToken(deps, turn.orgId);
    if (!token) return;
    await deps.client.chatUpdate(token, {
      channel: slack.channel,
      ts: slack.placeholderTs,
      text,
      ...(blocks && blocks.length ? { blocks } : {}),
    });
  }

  /** Post a `queue`d GitHub-issue offer for this turn's conversation AFTER the reply has
   *  landed, so the prompt never appears before the conclusion. Best-effort: a failure here
   *  must never affect the delivered reply. */
  async function flushQueuedOffer(turn: QueuedTurn): Promise<void> {
    try {
      const offer = await getUnpostedOfferForConversation(deps.db, turn.laneId);
      if (!offer) return;
      const token = await resolveSlackToken(deps, turn.orgId);
      if (!token) return;
      const { text, blocks } = renderCopilotOfferMessage(offer);
      const posted = await deps.client.chatPostMessage(token, {
        channel: offer.slackChannelId, threadTs: offer.slackThreadTs, text, blocks: blocks as object[],
      });
      if (posted.ok && posted.ts) await setCopilotIssueOfferMessageTs(deps.db, offer.id, posted.ts);
    } catch (err) {
      log.error({ err }, 'queued copilot offer post failed (best-effort)');
    }
  }

  /** Post a queued incident-report offer AFTER the reply has landed. Best-effort: a failure
   *  here must never affect the delivered reply or the issue-offer posting. */
  async function flushQueuedReportOffer(turn: QueuedTurn): Promise<void> {
    try {
      const offer = await getUnpostedReportOfferForConversation(deps.db, turn.laneId);
      if (!offer) return;
      const token = await resolveSlackToken(deps, turn.orgId);
      if (!token) return;
      const text = '📄 Generate an incident report?';
      const blocks = [
        { type: 'section', text: { type: 'mrkdwn', text } },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Generate', emoji: true },
              style: 'primary',
              action_id: `report_offer:${offer.id}:generate`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'No thanks', emoji: true },
              action_id: `report_offer:${offer.id}:decline`,
            },
          ],
        },
      ];
      const posted = await deps.client.chatPostMessage(token, {
        channel: offer.slackChannelId, threadTs: offer.slackThreadTs, text, blocks: blocks as object[],
      });
      if (posted.ok && posted.ts) await setReportOfferMessageTs(deps.db, offer.id, posted.ts);
    } catch (err) {
      log.error({ err }, 'queued report offer post failed (best-effort)');
    }
  }

  return async function onEvent(turn: QueuedTurn, ev: ModelEvent): Promise<void> {
    if (turn.source !== 'slack') return;
    const slack = (turn.payload as SlackPayload)?.slack;
    if (!slack) return;

    // Intermediate events never edit the placeholder (it stays "💭 thinking…" — no churn like
    // "Delegating to Orchestrator…"). Only the terminal `done` carries the reply.
    if (ev.type !== 'done') return;

    const md = ev.answer?.trim() || '(no response)';

    await appendConversationMessage(deps.db, {
      conversationId: turn.laneId,
      role: 'assistant',
      content: md,            // persist raw markdown
    });

    const blocks = markdownToBlocks(md);
    const fallback = markdownToFallbackText(md) || md;
    await editPlaceholder(turn, slack, fallback, blocks);

    // queued Slack interactions (e.g. the GitHub issue offer, report offer) post only after the reply.
    await flushQueuedOffer(turn);
    await flushQueuedReportOffer(turn);
  };
}

/** A short, human one-liner for the underlying error — drops any trailing JSON blob
 *  (e.g. `gemini 400: {…}` → `gemini 400`) and caps the length. */
function shortError(err: { name?: string; message?: string }): string {
  const m = (err.message ?? err.name ?? 'unknown error').toString();
  const cut = (m.split(/\s*[:{]/)[0] ?? m).trim() || m;
  return cut.slice(0, 200);
}

/** Report a FAILED turn to the originating Slack thread, gracefully and classified.
 *  Works for nested internal sub-agent turns too: the root Slack thread is resolved from the
 *  conversation tree. Retryable failures (rate limits / transient) ask the user to try again;
 *  permanent ones surface a simple error and point at an admin. Every failure is logged with
 *  structured context for tracking. Cancellations are intentional → no message. */
export async function deliverSlackError(deps: DeliveryDeps, turn: QueuedTurn): Promise<void> {
  if (turn.status === 'cancelled') return; // user-initiated; nothing to apologise for
  const target = await getSlackRootTarget(deps.db, turn.laneId);
  if (!target) return; // not part of a Slack-rooted flow

  const err = (turn.error ?? {}) as { class?: string; name?: string; message?: string };
  const retryable = err.class === 'temporary';
  const text = retryable
    ? "⚠️ We're a bit overloaded right now and couldn't finish this — please try again in a moment (just @-mention us again)."
    : `⚠️ Something went wrong while we were working on this: \`${shortError(err)}\`. This looks like a bug — please reach out to an admin.`;

  // Structured tracking log — the failing turn's full error is also on
  // message_queue.error and the trace step, so it stays visible in the super RunInspector.
  log.error({
    rootChannel: target.channel,
    thread: target.threadTs,
    failedConversation: turn.laneId,
    failedTurn: turn.id,
    errorClass: err.class ?? 'unknown',
    retryable,
    error: err.message ?? err.name ?? 'unknown',
  }, 'slack-error');

  const token = await resolveSlackToken(deps, target.orgId);
  if (!token) return;
  // Edit the in-flight placeholder ("💭 thinking…" / "🛠️ Delegating to …") so it doesn't dangle;
  // fall back to a fresh threaded message if there's no placeholder to edit.
  if (target.placeholderTs) {
    await deps.client.chatUpdate(token, { channel: target.channel, ts: target.placeholderTs, text }).catch(() => {});
  } else {
    await deps.client.chatPostMessage(token, { channel: target.channel, threadTs: target.threadTs, text }).catch(() => {});
  }
}
