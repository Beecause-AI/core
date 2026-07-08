import type { CopilotIssueOffer } from '../store/types.js';

/** When a Slack-posting agent interaction is sent relative to the turn:
 *  - `immediate`: posted during the turn (e.g. slack.reply_in_thread / slack.post_message).
 *  - `queue`: deferred until after the turn's final reply lands (e.g. the GitHub issue offer),
 *    so the prompt never appears before the conclusion. */
export type SlackPostMode = 'immediate' | 'queue';

/** action_ids / block_id for the GitHub issue offer prompt. Shared by the renderer (here),
 *  the engine-worker delivery (which posts the prompt), and the server interactions handler
 *  (which reads the clicked action / selected repo). */
export const COPILOT_BLOCK_IDS = { repo: 'copilot_issue_repo' } as const;
export const COPILOT_ACTION_IDS = { create: 'copilot_issue_create', dismiss: 'copilot_issue_dismiss', repoSelect: 'copilot_issue_repo_select' } as const;

/** Render the Block Kit Yes/No prompt for a GitHub issue offer. */
export function renderCopilotOfferMessage(
  offer: Pick<CopilotIssueOffer, 'id' | 'summary' | 'repo' | 'candidateRepos'>,
): { text: string; blocks: unknown[] } {
  const { id: offerId, summary, repo, candidateRepos } = offer;
  const heading = 'Raise a GitHub issue?';
  const createLabel = 'Create GitHub issue';
  const header = { type: 'section', text: { type: 'mrkdwn', text: `:robot_face: *${heading}*\n${summary}` } };
  const createBtn = { type: 'button', text: { type: 'plain_text', text: createLabel, emoji: true }, style: 'primary', action_id: COPILOT_ACTION_IDS.create, value: `${offerId}:create` };
  const noBtn = { type: 'button', text: { type: 'plain_text', text: 'No', emoji: true }, action_id: COPILOT_ACTION_IDS.dismiss, value: `${offerId}:dismiss` };
  if (repo) {
    return { text: summary, blocks: [header, { type: 'context', elements: [{ type: 'mrkdwn', text: `Repo: \`${repo}\`` }] }, { type: 'actions', elements: [createBtn, noBtn] }] };
  }
  const options = candidateRepos.slice(0, 100).map((r) => ({ text: { type: 'plain_text', text: r.length > 75 ? r.slice(0, 75) : r }, value: r }));
  const select = { type: 'static_select', action_id: COPILOT_ACTION_IDS.repoSelect, placeholder: { type: 'plain_text', text: 'Pick a repo' }, options, initial_option: options[0] };
  return { text: summary, blocks: [header, { type: 'actions', block_id: COPILOT_BLOCK_IDS.repo, elements: [select, createBtn, noBtn] }] };
}
