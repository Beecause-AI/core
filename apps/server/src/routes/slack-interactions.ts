import type { FastifyInstance } from 'fastify';
import {
  decryptSecret, keyFromBase64, getIntegrationByTeamId, getIntegration, getAgentRun,
  resolveAgentRunIfSuspended, enqueueTurn, getConversation, getProject, getOrgById, credsForRow, realGithubClient,
  getCopilotIssueOffer, claimCopilotIssueOffer, declineCopilotIssueOffer, markCopilotIssueOfferCreated, markCopilotIssueOfferFailed,
  COPILOT_ACTION_IDS, COPILOT_BLOCK_IDS,
  getReportOffer, claimReportOffer, declineReportOffer,
  realSlackClient, type SlackClient, type GithubClient, type ReportGenPublisher,
  realGitlabClient, type GitlabClient, gitlabCredsForRow,
} from '@intellilabs/core';
import { verifySlackSignature } from '../integrations/slack/webhook.js';
import { appendIntegrationSkills } from '../integrations/skill.js';

export type SlackInteractionsOpts = {
  client?: SlackClient;
  publish?: (laneId: string, turnId: string) => Promise<void>;
  githubClient?: GithubClient;
  gitlabClient?: GitlabClient;
  reportGenPublisher?: ReportGenPublisher;
};

export async function slackInteractionsRoutes(app: FastifyInstance, opts: SlackInteractionsOpts = {}) {
  const client = opts.client ?? realSlackClient;
  const publish = opts.publish ?? (async () => {});
  const githubClient = opts.githubClient ?? realGithubClient;
  const gitlabClient = opts.gitlabClient ?? realGitlabClient;
  const reportGenPublisher = opts.reportGenPublisher;
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  app.post('/slack/interactions', async (req, reply) => {
    const raw = req.rawBody ?? '';

    // Slack sends interactions as application/x-www-form-urlencoded: payload=<url-encoded JSON>
    const payloadStr = new URLSearchParams(raw).get('payload');
    if (!payloadStr) return reply.code(400).send({ error: 'missing payload' });
    let parsed: any;
    try { parsed = JSON.parse(payloadStr); }
    catch { return reply.code(400).send({ error: 'invalid payload json' }); }

    const teamId = parsed.team?.id as string | undefined;
    if (!teamId) return reply.code(400).send({ error: 'no team id' });

    const conn = await getIntegrationByTeamId(app.db, teamId);
    if (!conn) return reply.code(401).send({ error: 'unknown team' });

    const signingSecret = conn.mode === 'custom_app'
      ? decryptSecret((conn.metadata as any).signingSecretCiphertext, secretsKey())
      : (app.config.SLACK_SIGNING_SECRET ?? '');
    const ts = req.headers['x-slack-request-timestamp'] as string | undefined;
    const sig = req.headers['x-slack-signature'] as string | undefined;
    if (!verifySlackSignature(raw, ts, sig, signingSecret)) return reply.code(401).send({ error: 'bad signature' });

    // ── Shared action parsing ─────────────────────────────────────────────────
    const action0 = parsed.actions?.[0];
    const actionId = String(action0?.action_id ?? '');

    // ── Report offer branch ───────────────────────────────────────────────────
    if (actionId.startsWith('report_offer:')) {
      // action_id format: report_offer:<offerId>:<verb>
      const parts = actionId.split(':');
      const offerId = parts[1] ?? '';
      const verb = parts[2] ?? '';

      const offer = await getReportOffer(app.db, offerId);
      if (!offer || offer.orgId !== conn.orgId) return reply.code(200).send();

      const userId = parsed.user?.id as string | undefined;
      const slackToken = conn.secretCiphertext ? decryptSecret(conn.secretCiphertext, secretsKey()) : null;
      const editReportMessage = async (text: string) => {
        if (slackToken && offer.slackMessageTs) {
          try { await client.chatUpdate(slackToken, { channel: offer.slackChannelId, ts: offer.slackMessageTs, text }); }
          catch (err) { app.log.error({ err }, 'report offer chatUpdate failed'); }
        }
      };

      if (verb === 'generate') {
        const won = await claimReportOffer(app.db, offerId);
        if (!won) return reply.code(200).send(); // double-click guard — already claimed
        if (reportGenPublisher) {
          await reportGenPublisher.publish({ offerId });
        }
        await editReportMessage('⏳ Generating report…');
        return reply.code(200).send();
      }

      if (verb === 'decline') {
        await declineReportOffer(app.db, offerId, userId ?? '');
        await editReportMessage(':no_entry: Report dismissed.');
        return reply.code(200).send();
      }

      return reply.code(200).send();
    }
    // ── end Report offer branch ───────────────────────────────────────────────

    // ── Copilot issue offer branch ────────────────────────────────────────────

    if (actionId.startsWith('copilot_issue_')) {
      // Selection events carry no decision — Slack includes the chosen value in state.values on create.
      if (actionId === COPILOT_ACTION_IDS.repoSelect) return reply.code(200).send();

      const [offerId, verb] = String(action0?.value ?? '').split(':');
      const offer = await getCopilotIssueOffer(app.db, offerId ?? '');
      if (!offer || offer.orgId !== conn.orgId) return reply.code(200).send();

      const userId = parsed.user?.id as string | undefined;
      // conn is already the Slack integration row — use its secretCiphertext directly.
      const slackToken = conn.secretCiphertext ? decryptSecret(conn.secretCiphertext, secretsKey()) : null;
      const editMessage = async (text: string) => {
        if (slackToken && offer.slackMessageTs) {
          try { await client.chatUpdate(slackToken, { channel: offer.slackChannelId, ts: offer.slackMessageTs, text }); }
          catch (err) { app.log.error({ err }, 'copilot offer chatUpdate failed'); }
        }
      };

      if (verb === 'dismiss') {
        await declineCopilotIssueOffer(app.db, offer.id, userId ?? null);
        await editMessage(`:no_entry: Dismissed by <@${userId}>`);
        return reply.code(200).send();
      }

      if (verb === 'create') {
        const selected = parsed.state?.values?.[COPILOT_BLOCK_IDS.repo]?.[COPILOT_ACTION_IDS.repoSelect]?.selected_option?.value as string | undefined;
        const targetRepo = offer.repo ?? selected ?? offer.candidateRepos[0] ?? null;
        if (!targetRepo) { await editMessage(':warning: Pick a repository first, then click Create.'); return reply.code(200).send(); }

        // Race guard: only the first click proceeds to create.
        if (!(await claimCopilotIssueOffer(app.db, offer.id))) return reply.code(200).send();

        try {
          const project = await getProject(app.db, offer.orgId, offer.projectId);
          const org = await getOrgById(app.db, offer.orgId);
          // Consumer app lives on the tenant subdomain (<orgSlug>.<domain>); the apex is the marketing site.
          const convoUrl = org?.slug && project?.slug && offer.conversationId
            ? `https://${org.slug}.${new URL(app.config.BASE_URL).hostname}/p/${project.slug}/conversations/${offer.conversationId}`
            : null;
          const footer = `\n\n---\nRaised from a Beecause RCA in project "${project?.name ?? offer.projectId}".`
            + (convoUrl
              ? `\n\n[View the Beecause conversation →](${convoUrl})`
              : ` Conversation id: ${offer.conversationId || '(unknown)'}.`);
          let issue: { number: number; url: string };
          if (offer.provider === 'gitlab') {
            const glConn = await getIntegration(app.db, offer.orgId, 'gitlab');
            if (!glConn) throw new Error('gitlab not connected');
            issue = await gitlabClient.createIssue(gitlabCredsForRow(glConn, app.config), targetRepo, offer.title, offer.body + footer);
          } else {
            const ghConn = await getIntegration(app.db, offer.orgId, 'github');
            if (!ghConn) throw new Error('github not connected');
            issue = await githubClient.createIssue(credsForRow(ghConn, app.config), targetRepo, offer.title, offer.body + footer);
          }
          // We no longer assign the issue to Copilot via the API: the Copilot coding agent kept
          // failing to start on API-assigned issues ("unable to start working on this issue"). The
          // issue is created with full RCA context; assign Copilot manually in GitHub if desired.
          await markCopilotIssueOfferCreated(app.db, offer.id, {
            repo: targetRepo, issueNumber: issue.number, issueUrl: issue.url,
            copilotAssigned: false, error: null,
            decidedBy: userId ?? null,
          });
          await editMessage(`:white_check_mark: Issue #${issue.number} created — ${issue.url}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await markCopilotIssueOfferFailed(app.db, offer.id, { error: msg, decidedBy: userId ?? null });
          await editMessage(`:x: Couldn't create the issue (${msg}).`);
        }
        return reply.code(200).send();
      }

      return reply.code(200).send();
    }
    // ── end Copilot issue offer branch ────────────────────────────────────────

    const action = parsed.actions?.[0];
    const [runId, verb] = String(action?.value ?? '').split(':');
    const decision = verb === 'approve' ? 'approved' : 'denied';

    const run = await getAgentRun(app.db, runId ?? '');
    if (!run || run.status !== 'suspended') return reply.code(200).send();

    // Verify the team's org matches the run's org (cross-org guard)
    if (run.orgId !== conn.orgId) return reply.code(200).send();

    const userId = parsed.user?.id as string | undefined;

    // Atomic conditional resolve: only the request that transitions the run out of
    // 'suspended' proceeds to enqueue. A second concurrent click loses the race and
    // gets a 200 no-op without enqueuing a duplicate resume turn.
    const won = await resolveAgentRunIfSuspended(app.db, run.id, {
      status: decision === 'approved' ? 'approved' : 'denied',
      approvedBy: userId,
    });
    if (!won) return reply.code(200).send();

    // Resolve projectId via the conversation (run.laneId == conversation.id for slack turns)
    const convo = await getConversation(app.db, run.laneId);
    // Resume: run.messages already carry the originally-assembled prompt (persona +
    // preamble, if any). Don't re-inject the preamble here — it would duplicate it
    // (the dedup guard also protects this). preamble defaults to false.
    const resumeMessages = convo
      ? await appendIntegrationSkills(app.db, convo.projectId, run.enabledTools as string[] ?? [], run.messages as { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }[])
      : run.messages;

    const turn = await enqueueTurn(app.db, {
      laneId: run.laneId,
      orgId: run.orgId,
      source: 'slack',
      payload: {
        resume: true,
        agentRunId: run.id,
        decision,
        model: run.model,
        messages: resumeMessages,
        enabledTools: run.enabledTools,
        slack: run.slack,
      },
    });
    await publish(run.laneId, turn.id);

    // Best-effort: update the Slack placeholder message to reflect the decision
    try {
      const slackConn = await getIntegration(app.db, run.orgId, 'slack');
      if (slackConn?.secretCiphertext) {
        const botToken = decryptSecret(slackConn.secretCiphertext, secretsKey());
        const slackMeta = run.slack as { channel?: string; placeholderTs?: string } | null;
        if (slackMeta?.channel && slackMeta.placeholderTs) {
          const text = decision === 'approved'
            ? `:white_check_mark: Approved by <@${userId}> — working…`
            : `:no_entry: Denied by <@${userId}>`;
          await client.chatUpdate(botToken, { channel: slackMeta.channel, ts: slackMeta.placeholderTs, text });
        }
      }
    } catch (err) {
      app.log.error({ err }, 'slack interactions: chatUpdate failed (best-effort)');
    }

    return reply.code(200).send();
  });
}
