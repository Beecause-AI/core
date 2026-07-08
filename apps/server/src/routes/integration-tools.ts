import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { realSlackClient, isIssueCreationEnabled, isGitlabIssueCreationEnabled, isReportGenerationEnabled, getIntegration, type SlackClient } from '@intellilabs/core';
import { reportToolDef, offerInvestigationReport } from '../integrations/report/offer-investigation-report.js';
import { githubToolDefs, callGithubTool, filterGithubToolDefs } from '../integrations/github/tools.js';
import { gitlabToolDefs, filterGitlabToolDefs, callGitlabTool } from '../integrations/gitlab/tools.js';
import { realGitlabClient, type GitlabClient } from '../integrations/gitlab/client.js';
import { slackToolDefs, callSlackTool } from '../integrations/slack/tools.js';
import { knowledgeGraphToolDefs, callKnowledgeGraphTool } from '../integrations/knowledge-graph/tools.js';
import { gcpToolDefs, filterGcpToolDefs, callGcpTool } from '../integrations/gcp/tools.js';
import { projectGcpContext } from '../integrations/gcp/signals.js';
import { cloudflareToolDefs, filterCloudflareToolDefs, callCloudflareTool } from '../integrations/cloudflare/tools.js';
import { projectHasCloudflare } from '../integrations/cloudflare/signals.js';
import { sentryToolDefs, filterSentryToolDefs, callSentryTool } from '../integrations/sentry/tools.js';
import { projectHasSentry } from '../integrations/sentry/signals.js';
import { grafanaToolDefs, filterGrafanaToolDefs, callGrafanaTool } from '../integrations/grafana/tools.js';
import { projectGrafanaContext } from '../integrations/grafana/signals.js';
import { awsToolDefs, filterAwsToolDefs, callAwsTool } from '../integrations/aws/tools.js';
import { projectAwsContext } from '../integrations/aws/signals.js';
import { azureToolDefs, filterAzureToolDefs, callAzureTool } from '../integrations/azure/tools.js';
import { projectAzureContext } from '../integrations/azure/signals.js';
import { datadogToolDefs, filterDatadogToolDefs, callDatadogTool } from '../integrations/datadog/tools.js';
import { projectDatadogContext } from '../integrations/datadog/signals.js';
import { dynatraceToolDefs, filterDynatraceToolDefs, callDynatraceTool } from '../integrations/dynatrace/tools.js';
import { projectDynatraceContext } from '../integrations/dynatrace/signals.js';
import { pagerdutyToolDefs, filterPagerDutyToolDefs, callPagerDutyTool } from '../integrations/pagerduty/tools.js';
import { projectPagerDutyContext } from '../integrations/pagerduty/signals.js';
import { realGithubClient, type GithubClient } from '../integrations/github/client.js';

export interface IntegrationToolsOpts {
  client?: GithubClient;
  slackClient?: SlackClient;
  gitlabClient?: GitlabClient;
  /** Service-to-service auth check; returns true if the caller is the engine SA. */
  verifyServiceAuth?: (req: FastifyRequest) => Promise<boolean>;
}

// Per-turn invocation context the engine forwards (generic; today only Slack populates it).
const Context = z.object({
  slackThread: z.object({ channel: z.string(), threadTs: z.string() }).optional(),
}).optional();
const ListBody = z.object({ orgId: z.string().min(1), projectId: z.string().min(1), context: Context });
const CallBody = ListBody.extend({ name: z.string().min(1), args: z.unknown().optional() });

export async function integrationToolsRoutes(app: FastifyInstance, opts: IntegrationToolsOpts = {}) {
  const client = opts.client ?? realGithubClient;
  const slackClient = opts.slackClient ?? realSlackClient;
  const gitlabClient = opts.gitlabClient ?? realGitlabClient;
  const verify = opts.verifyServiceAuth ?? (async () => false);

  const authGuard = { preHandler: [async (req: FastifyRequest, reply: any) => {
    if (!(await verify(req))) return reply.code(401).send({ error: 'unauthorized' });
  }] };

  app.post('/int/tools/list', authGuard, async (req) => {
    const { orgId, projectId, context } = ListBody.parse(req.body);
    const gcpCtx = await projectGcpContext(app.db, orgId, projectId);
    const gcp = filterGcpToolDefs(gcpToolDefs(), gcpCtx);
    const cfHas = await projectHasCloudflare(app.db, projectId);
    const cloudflare = filterCloudflareToolDefs(cloudflareToolDefs(), cfHas);
    const sentryHas = await projectHasSentry(app.db, projectId);
    const sentry = filterSentryToolDefs(sentryToolDefs(), sentryHas);
    const grafanaCtx = await projectGrafanaContext(app.db, orgId, projectId);
    const grafana = filterGrafanaToolDefs(grafanaToolDefs(), grafanaCtx);
    const awsCtx = await projectAwsContext(app.db, orgId, projectId);
    const aws = filterAwsToolDefs(awsToolDefs(), awsCtx);
    const azureCtx = await projectAzureContext(app.db, orgId, projectId);
    const azure = filterAzureToolDefs(azureToolDefs(), azureCtx);
    const ddCtx = await projectDatadogContext(app.db, orgId, projectId);
    const datadog = filterDatadogToolDefs(datadogToolDefs(), ddCtx);
    const dtCtx = await projectDynatraceContext(app.db, orgId, projectId);
    const dynatrace = filterDynatraceToolDefs(dynatraceToolDefs(), dtCtx);
    const pdCtx = await projectPagerDutyContext(app.db, orgId, projectId);
    const pagerduty = filterPagerDutyToolDefs(pagerdutyToolDefs(), pdCtx);
    const issuesEnabled = !!context?.slackThread && await isIssueCreationEnabled(app.db, orgId, projectId);
    const github = filterGithubToolDefs(githubToolDefs(), { issuesEnabled });
    const gitlabConn = await getIntegration(app.db, orgId, 'gitlab');
    const gitlabIssues = !!context?.slackThread && await isGitlabIssueCreationEnabled(app.db, orgId, projectId);
    const gitlab = gitlabConn ? filterGitlabToolDefs(gitlabToolDefs(), { issuesEnabled: gitlabIssues }) : [];
    const reportsEnabled = !!context?.slackThread && await isReportGenerationEnabled(app.db, orgId, projectId);
    const report = reportsEnabled ? [reportToolDef()] : [];
    const tools = [...github, ...slackToolDefs(), ...knowledgeGraphToolDefs(), ...gcp, ...cloudflare, ...sentry, ...grafana, ...aws, ...azure, ...datadog, ...dynatrace, ...pagerduty, ...gitlab, ...report];
    // reply_in_thread is only offered when this conversation came from Slack.
    const gated = context?.slackThread ? tools : tools.filter((t) => t.name !== 'integration.slack.reply_in_thread');
    return { tools: gated };
  });

  app.post('/int/tools/call', authGuard, async (req) => {
    const { orgId, projectId, name, args, context } = CallBody.parse(req.body);
    if (name.startsWith('integration.github.')) {
      return callGithubTool({ db: app.db, orgId, projectId, client, slackClient, slackThread: context?.slackThread, config: app.config }, name, args);
    }
    if (name.startsWith('integration.slack.')) {
      return callSlackTool({ db: app.db, orgId, projectId, slackClient, config: app.config, slackThread: context?.slackThread }, name, args);
    }
    if (name.startsWith('integration.knowledge-graph.')) {
      return callKnowledgeGraphTool({ db: app.db, orgId, projectId }, name, args);
    }
    if (name.startsWith('integration.gcp.')) {
      return callGcpTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.cloudflare.')) {
      return callCloudflareTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.sentry.')) {
      return callSentryTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.grafana.')) {
      return callGrafanaTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.aws.')) {
      return callAwsTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.azure.')) {
      return callAzureTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.datadog.')) {
      return callDatadogTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.dynatrace.')) {
      return callDynatraceTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.pagerduty.')) {
      return callPagerDutyTool({ db: app.db, orgId, projectId, config: app.config }, name, args);
    }
    if (name.startsWith('integration.gitlab.')) {
      return callGitlabTool({ db: app.db, orgId, projectId, client: gitlabClient, slackThread: context?.slackThread, config: app.config }, name, args);
    }
    if (name.startsWith('integration.report.')) {
      return offerInvestigationReport({ db: app.db, orgId, projectId, slackThread: context?.slackThread }, args);
    }
    return { content: `unknown tool ${name}`, isError: true };
  });
}
