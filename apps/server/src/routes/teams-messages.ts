import type { FastifyInstance } from 'fastify';
import {
  getIntegrationByTenantId, getTeamsBinding, upsertPendingTeamsBinding,
  findOrCreateTeamsConversation, appendConversationMessage, listConversationMessages,
  getProjectOrchestrator, getSystemAgent, insertIntegrationEvent, enqueueTurn,
  getOrgById, isIssueCreationEnabled, isReportGenerationEnabled, authenticateActivity, parseActivity, stripMention,
  connectCardAttachment, realTeamsClient,
  type TeamsClient, type TeamsAuth, type OrgIntegration, type Assistant,
} from '@intellilabs/core';
import type { ModelMessage } from '@intellilabs/engine';
import { appendIntegrationSkills } from '../integrations/skill.js';

const PROVIDER = 'teams';

export type TeamsMessagesOpts = {
  client?: TeamsClient;
  publish?: (laneId: string, turnId: string) => Promise<void>;
  /** Test seam: override the Bot Framework JWT verifier. Defaults to the real `authenticateActivity`. */
  authenticate?: (auth: TeamsAuth, activity: unknown, header: string | undefined) => Promise<boolean>;
};

function authFromConfig(app: FastifyInstance): TeamsAuth {
  return {
    appId: app.config.MICROSOFT_APP_ID ?? '',
    appPassword: app.config.MICROSOFT_APP_PASSWORD ?? '',
    tenantId: app.config.MICROSOFT_APP_TENANT_ID ?? '',
  };
}

export async function teamsMessagesRoutes(app: FastifyInstance, opts: TeamsMessagesOpts = {}) {
  const client = opts.client ?? realTeamsClient;
  const publish = opts.publish ?? (async () => {});
  const doAuthenticate = opts.authenticate ?? authenticateActivity;

  app.post('/teams/messages', async (req, reply) => {
    const auth = authFromConfig(app);
    const botId = `28:${auth.appId}`;
    const header = req.headers['authorization'] as string | undefined;

    if (!(await doAuthenticate(auth, req.body, header))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const act = parseActivity(req.body, botId);

    // Respond 200 fast; only handle bot-mention message activities with a tenantId.
    if (act.type !== 'message' || !act.isBotMentioned || !act.tenantId) {
      return reply.code(200).send();
    }

    const conn = await getIntegrationByTenantId(app.db, act.tenantId);

    // Unknown tenant OR unbound channel → reply with a connect card (no persistence needed).
    const binding = conn ? await getTeamsBinding(app.db, conn.id, act.conversationId) : null;
    if (!conn || !binding || binding.status !== 'bound' || !binding.projectId) {
      if (conn) {
        await upsertPendingTeamsBinding(app.db, {
          orgIntegrationId: conn.id,
          teamsConversationId: act.conversationId,
        });
      }
      const org = conn ? await getOrgById(app.db, conn.orgId) : null;
      const base = new URL(app.config.BASE_URL);
      const slug = org?.slug ?? 'app';
      const url = `${base.protocol}//${slug}.${base.host}/teams/connect?tenant=${encodeURIComponent(act.tenantId)}&conversation=${encodeURIComponent(act.conversationId)}&serviceUrl=${encodeURIComponent(act.serviceUrl)}`;
      await client.sendActivity(auth, {
        serviceUrl: act.serviceUrl,
        conversationId: act.conversationId,
        replyToId: act.activityId,
        text: 'Connect this channel to a Beecause project to get started.',
        attachments: [connectCardAttachment(url)],
      });
      return reply.code(200).send();
    }

    // Dedup on activity id (Teams redelivers).
    const fresh = await insertIntegrationEvent(app.db, {
      orgId: conn.orgId,
      provider: PROVIDER,
      category: 'message',
      eventType: 'message',
      action: null,
      deliveryId: act.activityId,
      repoFullName: null,
      actorLogin: act.fromId,
      mentionsBot: true,
      payload: req.body,
    });
    if (!fresh) return reply.code(200).send();

    try {
      await handleMention(app, { client, publish, auth, conn, binding, act });
    } catch (err) {
      app.log.error({ err }, 'teams handleMention failed');
    }
    return reply.code(200).send();
  });
}

type Ctx = {
  client: TeamsClient;
  publish: (l: string, t: string) => Promise<void>;
  auth: TeamsAuth;
  conn: OrgIntegration;
  binding: { projectId: string | null };
  act: ReturnType<typeof parseActivity>;
};

async function handleMention(app: FastifyInstance, ctx: Ctx) {
  const { client, publish, auth, conn, binding, act } = ctx;
  const projectId = binding.projectId!;

  const orchestrator = await getProjectOrchestrator(app.db, projectId);
  if (!orchestrator) {
    await client.sendActivity(auth, {
      serviceUrl: act.serviceUrl,
      conversationId: act.conversationId,
      replyToId: act.activityId,
      text: "⚙️ This channel is connected, but its Beecause project has no incident response team yet. Generate a team on the project's **Assistants** page to get started.",
    });
    return;
  }

  const convo = await findOrCreateTeamsConversation(app.db, {
    orgId: conn.orgId,
    projectId,
    assistantId: null,
    teamsTenantId: act.tenantId!,
    teamsConversationId: act.conversationId,
  });

  const text = stripMention(act.text);
  await appendConversationMessage(app.db, {
    conversationId: convo.id,
    role: 'user',
    content: text,
    teamsUserId: act.fromId,
  });

  const ph = await client.sendActivity(auth, {
    serviceUrl: act.serviceUrl,
    conversationId: act.conversationId,
    replyToId: act.activityId,
    text: '💭 thinking…',
  });
  const placeholderActivityId = ph.ok && ph.activityId ? ph.activityId : act.activityId;

  const history = (await listConversationMessages(app.db, convo.id)).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const route = await buildTeamsMentionRoute(app, {
    orgId: conn.orgId,
    projectId,
    orchestrator,
    history,
  });

  const turn = await enqueueTurn(app.db, {
    laneId: convo.id,
    orgId: conn.orgId,
    source: 'teams',
    payload: {
      ...route,
      teams: {
        serviceUrl: act.serviceUrl,
        conversationId: act.conversationId,
        placeholderActivityId,
        tenantId: act.tenantId,
      },
    },
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

/** Decide the enqueued turn payload for a Teams mention: a Teams system-agent turn that
 *  delegates to the project's orchestrator. Mirror of `buildMentionRoute` in slack-events.ts. */
export async function buildTeamsMentionRoute(
  app: FastifyInstance,
  input: {
    orgId: string;
    projectId: string;
    orchestrator: Assistant;
    history: ModelMessage[];
  },
): Promise<MentionPayload> {
  const { orgId, projectId, orchestrator, history } = input;
  const sys = getSystemAgent('teams')!;
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
    systemAgentKey: 'teams',
  };
}
