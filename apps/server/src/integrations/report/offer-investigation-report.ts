import {
  isReportGenerationEnabled,
  createReportOffer,
  getSlackConversation,
} from '@intellilabs/core';
import type { Db } from '@intellilabs/core';

export interface ReportToolCtx {
  db: Db;
  orgId: string;
  projectId: string;
  slackThread?: { channel: string; threadTs: string };
}

export interface ReportToolResult {
  content: string;
  isError?: boolean;
}

/** Tool definition shape (mirrors the GitHub integration's ToolDef). */
export interface ReportToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: 'integration';
  mutates: boolean;
}

export const OFFER_INVESTIGATION_REPORT_NAME = 'integration.report.offer_investigation_report';

/** Static tool def for offer_investigation_report. */
export function reportToolDef(): ReportToolDef {
  return {
    name: OFFER_INVESTIGATION_REPORT_NAME,
    description:
      'Once your investigation has reached a conclusion, offer the user a shareable HTML incident report. ' +
      'Call this tool as your final action — it queues a Yes/No prompt in the Slack thread. ' +
      'The report content is generated later by an AI agent when the user confirms. ' +
      'No arguments are needed.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    kind: 'integration',
    mutates: false,
  };
}

/** A `queue`d Slack interaction: this tool only RECORDS the offer; the Block Kit prompt is
 *  posted to the thread by the engine-worker AFTER the run's reply lands (see slack-delivery),
 *  so the button never shows before the conclusion. Contrast with `immediate` slack tools
 *  (reply_in_thread / post_message) which post during the turn. */
export async function offerInvestigationReport(ctx: ReportToolCtx, _rawArgs: unknown): Promise<ReportToolResult> {
  if (!ctx.slackThread) {
    return { content: 'offer_investigation_report is only available in a Slack conversation', isError: true };
  }
  if (!(await isReportGenerationEnabled(ctx.db, ctx.orgId, ctx.projectId))) {
    return { content: 'Report generation is not enabled for this project', isError: true };
  }

  const convo = await getSlackConversation(ctx.db, ctx.slackThread.channel, ctx.slackThread.threadTs);

  const offer = await createReportOffer(ctx.db, {
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    conversationId: convo?.id ?? '',
    slackChannelId: ctx.slackThread.channel,
    slackThreadTs: ctx.slackThread.threadTs,
  });

  return { content: JSON.stringify({ status: 'offered', offerId: offer.id, mode: 'queue', awaitingUser: true }) };
}
