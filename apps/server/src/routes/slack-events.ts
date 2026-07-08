import type { FastifyInstance } from 'fastify';
import {
  decryptSecret, keyFromBase64, getIntegrationByTeamId,
  findOrCreateSlackConversation, appendConversationMessage, listConversationMessages,
  getBinding, upsertPendingBinding, getProjectOrchestrator, getSystemAgent,
  insertIntegrationEvent, enqueueTurn, getOrgById, isIssueCreationEnabled, isReportGenerationEnabled,
  realSlackClient, type SlackClient, type OrgIntegration, type Assistant,
} from '@intellilabs/core';
import type { ModelMessage } from '@intellilabs/engine';
import { verifySlackSignature } from '../integrations/slack/webhook.js';
import { appendIntegrationSkills } from '../integrations/skill.js';

const PROVIDER = 'slack';

export type SlackEventsOpts = {
  client?: SlackClient;
  publish?: (laneId: string, turnId: string) => Promise<void>;
};

export async function slackEventsRoutes(app: FastifyInstance, opts: SlackEventsOpts = {}) {
  const client = opts.client ?? realSlackClient;
  const publish = opts.publish ?? (async () => {});
  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);

  app.post('/slack/events', async (req, reply) => {
    const raw = req.rawBody ?? '';
    const body = (req.body ?? {}) as any;

    if (body?.type === 'url_verification') return reply.code(200).send({ challenge: body.challenge });

    const teamId = body?.team_id as string | undefined;
    if (!teamId) return reply.code(400).send({ error: 'no team_id' });
    const conn = await getIntegrationByTeamId(app.db, teamId);
    if (!conn) return reply.code(401).send({ error: 'unknown team' });

    const signingSecret = conn.mode === 'custom_app'
      ? decryptSecret((conn.metadata as any).signingSecretCiphertext, secretsKey())
      : (app.config.SLACK_SIGNING_SECRET ?? '');
    const ts = req.headers['x-slack-request-timestamp'] as string | undefined;
    const sig = req.headers['x-slack-signature'] as string | undefined;
    if (!verifySlackSignature(raw, ts, sig, signingSecret)) return reply.code(401).send({ error: 'bad signature' });

    const ev = body?.event;
    if (body?.type !== 'event_callback' || ev?.type !== 'app_mention') return reply.code(200).send({ ok: true });
    if (ev.bot_id) return reply.code(200).send({ ok: true });

    const deliveryId = (body.event_id as string | undefined) ?? `${ev.channel}:${ev.ts}`;
    const fresh = await insertIntegrationEvent(app.db, {
      orgId: conn.orgId, provider: PROVIDER, category: 'app_mention', eventType: 'app_mention', action: null,
      deliveryId, repoFullName: null, actorLogin: (ev.user as string) ?? null, mentionsBot: true, payload: body,
    });
    if (!fresh) return reply.code(200).send({ ok: true });

    try {
      await handleMention(app, { client, publish, secretsKey, conn, ev });
    } catch (err) {
      app.log.error({ err }, 'slack handleMention failed');
    }
    return reply.code(200).send({ ok: true });
  });
}

type Ctx = { client: SlackClient; publish: (l: string, t: string) => Promise<void>; secretsKey: () => Buffer; conn: OrgIntegration; ev: any };

async function handleMention(app: FastifyInstance, ctx: Ctx) {
  const { client, publish, secretsKey, conn, ev } = ctx;
  const botToken = decryptSecret(conn.secretCiphertext!, secretsKey());
  const channel = ev.channel as string;
  const threadTs = (ev.thread_ts as string) ?? (ev.ts as string);

  const binding = await getBinding(app.db, conn.id, channel);
  if (!binding || binding.status !== 'bound' || !binding.projectId) {
    await upsertPendingBinding(app.db, { orgIntegrationId: conn.id, slackChannelId: channel });
    const org = await getOrgById(app.db, conn.orgId);
    const teamId = (conn.metadata as { teamId?: string } | null)?.teamId ?? '';
    const base = new URL(app.config.BASE_URL);
    const connectUrl = `${base.protocol}//${org?.slug ?? ''}.${base.host}/slack/connect?team=${encodeURIComponent(teamId)}&channel=${encodeURIComponent(channel)}&thread=${encodeURIComponent(threadTs)}`;
    await client.chatPostMessage(botToken, {
      channel, threadTs,
      text: "Not connected to a project in this channel yet — connect this channel to a Beecause project to get started.",
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `👋 Not connected to a project in <#${channel}> yet.\nConnect this channel to a Beecause project to get started.` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Connect this channel', emoji: true }, url: connectUrl, style: 'primary' }] },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Only project owners or managers can connect a channel.' }] },
      ],
    });
    return;
  }

  // Front-door routing. A mention is always handled by the Slack Intake SYSTEM agent, which
  // delegates to the project's orchestrator (the single is_lead assistant). There is no
  // per-channel assistant link — routing is automatic. With no orchestrator yet (team not
  // generated), tell the reporter to set one up.
  const orchestrator = await getProjectOrchestrator(app.db, binding.projectId);
  if (!orchestrator) {
    await client.chatPostMessage(botToken, {
      channel, threadTs,
      text: "This project doesn't have an incident response team yet — generate one in Beecause to get started.",
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: "⚙️ This channel is connected, but its Beecause project has no incident response team yet.\nGenerate a team on the project's *Assistants* page to get started." } },
      ],
    });
    return;
  }

  // The conversation belongs to the Slack system agent (assistant_id null); it fronts the orchestrator.
  const convo = await findOrCreateSlackConversation(app.db, {
    orgId: conn.orgId, projectId: binding.projectId, assistantId: null,
    slackChannelId: channel, slackThreadTs: threadTs,
  });

  const text = stripMention(ev.text as string);
  await appendConversationMessage(app.db, { conversationId: convo.id, role: 'user', content: text, slackUserId: ev.user ?? null });

  const ph = await client.chatPostMessage(botToken, { channel, threadTs, text: '💭 thinking…' });
  const placeholderTs = ph.ok && ph.ts ? ph.ts : threadTs;

  const history = await listConversationMessages(app.db, convo.id).then((h) =>
    h.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })));

  const route = await buildMentionRoute(app, { orgId: conn.orgId, projectId: binding.projectId, orchestrator, history });

  const turn = await enqueueTurn(app.db, {
    laneId: convo.id, orgId: conn.orgId, source: 'slack',
    payload: { ...route, slack: { channel, threadTs, placeholderTs } },
  });
  await publish(convo.id, turn.id);
}

type MentionPayload = {
  model: string;
  provider: string | null;
  messages: ModelMessage[];
  enabledTools: string[];
  projectId: string;
  assistantId: string | null;
  systemAgentKey?: string;
};

/** Decide the enqueued turn payload for a mention: a Slack system-agent turn that delegates to
 *  the project's orchestrator. Pure but for the integration-skill assembly (which reads the
 *  project's connected integrations). */
export async function buildMentionRoute(
  app: FastifyInstance,
  input: {
    orgId: string;
    projectId: string;
    orchestrator: Assistant;
    history: ModelMessage[];
  },
): Promise<MentionPayload> {
  const { orgId, projectId, orchestrator, history } = input;
  const sys = getSystemAgent('slack')!;
  const enabledTools = [...sys.tools, `agent.${orchestrator.id}`];
  if (await isIssueCreationEnabled(app.db, orgId, projectId)) {
    enabledTools.push('integration.github.offer_github_issue');
  }
  if (await isReportGenerationEnabled(app.db, orgId, projectId)) {
    enabledTools.push('integration.report.offer_investigation_report');
  }
  const messages = await appendIntegrationSkills(app.db, projectId, enabledTools, [
    { role: 'system' as const, content: sys.persona },
    ...history,
  ], { preamble: false });
  return {
    model: sys.model,
    provider: null,
    messages,
    enabledTools,
    projectId,
    assistantId: null,
    systemAgentKey: 'slack',
  };
}

function stripMention(text: string): string {
  return (text ?? '').replace(/<@[A-Z0-9_]+>/g, '').trim();
}
