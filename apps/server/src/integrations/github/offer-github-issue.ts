import {
  listProjectRepos, getSlackConversation, createCopilotIssueOffer, isIssueCreationEnabled, getIntegration,
} from '@intellilabs/core';
import type { ToolCtx, ToolResult } from './tools.js';

/** A `queue`d Slack interaction: this tool only RECORDS the offer; the Block Kit prompt is
 *  posted to the thread by the engine-worker AFTER the run's reply lands (see slack-delivery),
 *  so the button never shows before the conclusion. Contrast with `immediate` slack tools
 *  (reply_in_thread / post_message) which post during the turn. */
export async function offerGithubIssue(ctx: ToolCtx, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const title = String(args.title ?? '').trim();
  const body = String(args.body ?? '').trim();
  const summary = String(args.summary ?? '').trim();
  if (!title || !body || !summary) return { content: 'title, body and summary are required', isError: true };
  if (!ctx.slackThread) return { content: 'offer_github_issue is only available in a Slack conversation', isError: true };
  if (!(await isIssueCreationEnabled(ctx.db, ctx.orgId, ctx.projectId))) {
    return { content: 'GitHub issue creation is not enabled for this project', isError: true };
  }

  const conn = await getIntegration(ctx.db, ctx.orgId, 'github');
  if (!conn) return { content: 'github not connected for this org', isError: true };
  const repos = (await listProjectRepos(ctx.db, ctx.projectId)).filter((r) => r.orgIntegrationId === conn.id).map((r) => r.repoFullName);
  if (repos.length === 0) return { content: 'this project has no repositories in scope', isError: true };

  let targetRepo: string | null = null;
  let candidateRepos: string[] = [];
  if (args.repo) {
    if (!repos.includes(String(args.repo))) return { content: `repo ${args.repo} is not in project scope`, isError: true };
    targetRepo = String(args.repo);
  } else {
    candidateRepos = repos;
  }

  const convo = await getSlackConversation(ctx.db, ctx.slackThread.channel, ctx.slackThread.threadTs);

  const offer = await createCopilotIssueOffer(ctx.db, {
    provider: 'github', orgId: ctx.orgId, projectId: ctx.projectId, conversationId: convo?.id ?? '',
    slackChannelId: ctx.slackThread.channel, slackThreadTs: ctx.slackThread.threadTs,
    repo: targetRepo, candidateRepos, title, body, summary,
  });

  return { content: JSON.stringify({ status: 'offered', offerId: offer.id, mode: 'queue', awaitingUser: true }) };
}
