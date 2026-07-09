import fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import type { Db, Store, Organization, OrgMember, Project } from '@intellilabs/core';
import type { AppConfig } from './config.js';
import type { SessionUser } from './auth/session.js';
import type { IdpAdmin } from './integrations/idp/admin.js';
import type { EmailSender } from './integrations/email/resend.js';
import type { TenantResolver } from './auth/tenant-resolver.js';
import type { AuthProvider } from './auth/provider.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    store: Store;
    config: AppConfig;
    idpAdmin: IdpAdmin | null;
    email: EmailSender | null;
    authProvider: AuthProvider | undefined;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    // org + orgRole set by resolveOrg / requireOrgMember (org-context.ts augments req.org separately)
    orgRole: OrgMember['role'] | null;
    project: Project | null;
    projectRole: 'admin' | 'user' | null;
    rawBody: string | null;
  }
}

export type AppDeps = {
  db: Db;
  /** Full store (Firestore + vector index) — needed by routes that touch vector search (memory CRUD). */
  store: Store;
  config: AppConfig;
  idpAdmin?: IdpAdmin;   // injected; real in prod, fake in tests
  /** Test seam: injectable TenantResolver; defaults to subdomain or single-tenant based on config.TENANT_MODE. */
  tenantResolver?: TenantResolver;
  /** Test seam: injectable AuthProvider; defaults to localAuthProvider when AUTH_BACKEND=local, gcpAuthProvider when IDP_API_KEY set, else undefined. */
  authProvider?: AuthProvider;
  /** Test seam: injectable password sign-in; defaults to a Web-API-key-backed REST client. */
  idpSignIn?: import('./integrations/idp/signin.js').IdpSignIn;
  /** Test seam: local public key for the IdP token verifier instead of Google's remote JWKS. */
  idpVerifyKey?: import('./integrations/idp/verify.js').IdpVerifyKey;
  email?: EmailSender;
  /** Test seam: injectable provider probe for model-key routes; defaults to the real network probe. */
  probe?: import('./routes/model-keys.js').ModelKeyRouteOpts['probe'];
  /** Test seam: injectable provider model-lister for /models routes; defaults to the real network call. */
  listModels?: import('./routes/models.js').ModelsRouteOpts['listModels'];
  /** Test seam: injectable MCP tool-lister; defaults to a gateway-backed client (or [] when no MCP_GATEWAY_URL). */
  mcpListTools?: import('./integrations/mcp/gateway.js').McpListTools;
  /** Test seam: injectable GitHub client for github routes; defaults to the real REST client. */
  githubClient?: import('./routes/github.js').GithubRouteOpts['client'];
  /** Test seam: injectable Slack client for slack routes; defaults to the real Slack client. */
  slackClient?: import('./routes/slack.js').SlackRouteOpts['client'];
  /** Test seam: injectable GCP client for gcp routes; defaults to the real GCP client. */
  gcpClient?: import('./routes/gcp.js').GcpRouteOpts['gcpClient'];
  /** Test seam: injectable GCP token minter for gcp routes; defaults to the real minter. */
  mintGcpToken?: import('./routes/gcp.js').GcpRouteOpts['mintToken'];
  /** Test seam: injectable Cloudflare client for cloudflare routes; defaults to the real client. */
  cloudflareClient?: import('@intellilabs/core').CloudflareClient;
  /** Test seam: injectable Sentry client for sentry routes; defaults to the real client. */
  sentryClient?: import('@intellilabs/core').SentryClient;
  /** Test seam: injectable Grafana client for grafana routes; defaults to the real client. */
  grafanaClient?: import('./routes/grafana.js').GrafanaRouteOpts['grafanaClient'];
  /** Test seam: injectable AWS client for aws routes; defaults to the real AWS client. */
  awsClient?: import('./routes/aws.js').AwsRouteOpts['awsClient'];
  /** Test seam: injectable Azure client for azure routes; defaults to the real Azure client. */
  azureClient?: import('./routes/azure.js').AzureRouteOpts['azureClient'];
  /** Test seam: injectable Datadog client for datadog routes; defaults to the real Datadog client. */
  datadogClient?: import('./routes/datadog.js').DatadogRouteOpts['datadogClient'];
  /** Test seam: injectable Dynatrace client for dynatrace routes; defaults to the real client. */
  dynatraceClient?: import('./routes/dynatrace.js').DynatraceRouteOpts['dynatraceClient'];
  /** Test seam: injectable PagerDuty client for pagerduty routes; defaults to the real client. */
  pagerdutyClient?: import('./routes/pagerduty.js').PagerDutyRouteOpts['pagerdutyClient'];
  /** Test seam: injectable GitLab client for gitlab routes; defaults to the real client. */
  gitlabClient?: import('./routes/gitlab.js').GitlabRouteOpts['client'];
  /** Test seam: injectable Slack client for slack events route; defaults to the real Slack client. */
  slackEventsClient?: import('./routes/slack-events.js').SlackEventsOpts['client'];
  /** Test seam: injectable publish function for slack events (doorbell to worker). */
  slackPublish?: (laneId: string, turnId: string) => Promise<void>;
  /** Test seam: injectable Teams client for teams messages route; defaults to the real Teams client. */
  teamsEventsClient?: import('./routes/teams-messages.js').TeamsMessagesOpts['client'];
  /** Test seam: injectable publish function for teams messages (doorbell to worker); reuses the same message_queue topic as slack. */
  teamsPublish?: (laneId: string, turnId: string) => Promise<void>;
  /** Test seam: injectable OIDC client (avoids network discovery in tests). Only used when AUTH_BACKEND=oidc. */
  oidcClient?: import('./integrations/oidc/client.js').OidcClient;
  /** Test seam: injectable authenticate function for teams messages route; defaults to the real Bot Framework JWT verifier. */
  teamsAuthenticate?: import('./routes/teams-messages.js').TeamsMessagesOpts['authenticate'];
  /** Test seam: service-auth verifier for /int tool API; defaults to deny (prod injects ID-token check). */
  verifyServiceAuth?: import('./routes/integration-tools.js').IntegrationToolsOpts['verifyServiceAuth'];
  /** Publisher for knowledge-graph build jobs; no-op when unset. */
  kgJobPublisher?: import('@intellilabs/core').KgJobPublisher;
  /** Publisher for team-autogen jobs; no-op when unset. */
  teamAutogenPublisher?: import('@intellilabs/core').TeamAutogenPublisher;
  /** Publisher for report-gen jobs; no-op when unset. */
  reportGenPublisher?: import('@intellilabs/core').ReportGenPublisher;
  /** Test seam: injectable embed function for team-memory routes; defaults to Vertex ADC when VERTEX_PROJECT is set. */
  embed?: (texts: string[]) => Promise<number[][]>;
  /** Structured logger; omitted in tests (silent). */
  logger?: FastifyBaseLogger;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = fastify({
    loggerInstance: deps.logger,
    disableRequestLogging: !deps.logger,
    // Trust exactly one hop: with Cloud Run, the Google Front End (GFE) is the
    // immediate socket connection and appends the real client IP as the last
    // X-Forwarded-For entry. trustProxy:1 makes req.ip resolve to that last
    // entry — the GFE-appended value — rather than a client-supplied one.
    // trustProxy:true would trust all hops and resolve to the first (leftmost)
    // XFF entry, which a client can freely forge.
    trustProxy: 1,
  });
  await app.register(new FastifyOtelInstrumentation().plugin());
  app.decorate('db', deps.db);
  app.decorate('store', deps.store);
  app.decorate('config', deps.config);
  app.decorate('idpAdmin', deps.idpAdmin ?? null);
  app.decorate('email', deps.email ?? null);
  // TenantResolver: subdomain (default/SaaS) or single-tenant (OSS), built from
  // config unless a test seam is injected.
  if (deps.tenantResolver) {
    app.decorate('tenantResolver', deps.tenantResolver);
  } else {
    const { subdomainTenantResolver, singleTenantResolver } = await import('./auth/tenant-resolver.js');
    const { getOrgBySlug } = await import('@intellilabs/core');
    const resolver = deps.config.TENANT_MODE === 'single'
      ? singleTenantResolver(() => getOrgBySlug(deps.db, deps.config.SINGLE_TENANT_SLUG ?? 'default'))
      : subdomainTenantResolver({ db: deps.db, baseUrl: deps.config.BASE_URL });
    app.decorate('tenantResolver', resolver);
  }
  app.decorateRequest('user', null);
  app.decorateRequest('org', null);
  app.decorateRequest('orgRole', null);
  app.decorateRequest('project', null);
  app.decorateRequest('projectRole', null);
  app.decorateRequest('rawBody', null);
  await app.register(cookie);

  // A no-body request that still carries `Content-Type: application/json` (e.g. DELETE or a
  // no-payload POST from the web api() helper) must not 500. Treat an empty body as undefined;
  // parse JSON otherwise.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const s = (body as string).trim();
    (req as typeof req & { rawBody: string | null }).rawBody = body as string;
    if (s === '') return done(null, undefined);
    try { done(null, JSON.parse(s)); }
    catch { const e = new Error('invalid json') as Error & { statusCode?: number }; e.statusCode = 400; done(e, undefined); }
  });

  // Capture rawBody for urlencoded POSTs (e.g. Slack interactions) so signature
  // verification can hash the exact bytes that were signed.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    (req as typeof req & { rawBody: string | null }).rawBody = body as string;
    done(null, body);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation failed', issues: err.issues });
    }
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: message });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  // Under /api so it traverses the same edge routing as the rest of the API —
  // Google's frontend reserves the bare /healthz path on run.app and never forwards it.
  app.get('/api/healthz', async () => ({ ok: true }));

  const { logoutRoutes } = await import('./auth/logout.js');
  await app.register(logoutRoutes);
  const { authMethodsRoutes } = await import('./auth/methods.js');
  await app.register(authMethodsRoutes);
  // AuthProvider: local (scrypt) or GCP Identity Platform, built from config unless a seam is injected.
  let authProvider: AuthProvider | undefined = deps.authProvider;
  if (!authProvider) {
    if (deps.config.AUTH_BACKEND === 'local') {
      const { localAuthProvider } = await import('./auth/provider.js');
      authProvider = localAuthProvider(deps.db);
    } else if (deps.idpSignIn || deps.config.IDP_API_KEY) {
      const { gcpAuthProvider } = await import('./auth/provider.js');
      const { makeIdpSignIn } = await import('./integrations/idp/signin.js');
      const signIn = deps.idpSignIn ?? makeIdpSignIn(deps.config.IDP_API_KEY!);
      authProvider = gcpAuthProvider(signIn);
    }
  }
  app.decorate('authProvider', authProvider);
  if (authProvider) {
    const { passwordAuthRoutes } = await import('./auth/password.js');
    await app.register(passwordAuthRoutes);
    // OSS self-serve signup: only available when a local auth provider is active
    // (single-tenant mode). GCP Identity Platform mode uses /api/auth/accept-invite.
    if (deps.config.AUTH_BACKEND === 'local') {
      const { registerRoutes } = await import('./auth/register.js');
      await app.register(registerRoutes);
    }
  }
  if (deps.config.AUTH_BACKEND === 'oidc') {
    const { oidcAuthRoutes } = await import('./auth/oidc.js');
    await app.register(oidcAuthRoutes, { oidcClient: deps.oidcClient });
  }
  if (deps.config.IDP_PROJECT_ID) {
    const { idpSessionRoutes } = await import('./auth/idp-session.js');
    const { makeIdpVerifier } = await import('./integrations/idp/verify.js');
    const verify = makeIdpVerifier({ projectId: deps.config.IDP_PROJECT_ID, getKey: deps.idpVerifyKey });
    await app.register(idpSessionRoutes, { verify });
  }
  const { orgRoutes } = await import('./routes/orgs.js');
  const { projectRoutes } = await import('./routes/projects.js');
  const { workspaceRoutes } = await import('./routes/workspaces.js');
  const { signupRoutes } = await import('./routes/signup.js');
  const { invitationRoutes } = await import('./routes/invitations.js');
  const { apiKeyRoutes } = await import('./routes/api-keys.js');
  await app.register(orgRoutes, { prefix: '/api' });
  const { orgSsoRoutes } = await import('./routes/org-sso.js');
  await app.register(orgSsoRoutes, { prefix: '/api' });
  await app.register(apiKeyRoutes, { prefix: '/api' });
  const { modelKeyRoutes } = await import('./routes/model-keys.js');
  await app.register(modelKeyRoutes, { prefix: '/api', probe: deps.probe });
  const { githubRoutes } = await import('./routes/github.js');
  await app.register(githubRoutes, { prefix: '/api', client: deps.githubClient });
  const { githubWebhookRoutes } = await import('./routes/github-webhook.js');
  await app.register(githubWebhookRoutes, { prefix: '/api' });
  const { stripeWebhookRoutes } = await import('./routes/stripe-webhook.js');
  await app.register(stripeWebhookRoutes, { prefix: '/api' });
  const { slackRoutes } = await import('./routes/slack.js');
  await app.register(slackRoutes, { prefix: '/api', client: deps.slackClient });
  const { slackEventsRoutes } = await import('./routes/slack-events.js');
  await app.register(slackEventsRoutes, { prefix: '/api', client: deps.slackEventsClient, publish: deps.slackPublish });
  const { slackInteractionsRoutes } = await import('./routes/slack-interactions.js');
  await app.register(slackInteractionsRoutes, { prefix: '/api', client: deps.slackEventsClient, publish: deps.slackPublish, githubClient: deps.githubClient, gitlabClient: deps.gitlabClient, reportGenPublisher: deps.reportGenPublisher });
  const { gcpRoutes } = await import('./routes/gcp.js');
  await app.register(gcpRoutes, { gcpClient: deps.gcpClient, mintToken: deps.mintGcpToken });
  const { cloudflareRoutes } = await import('./routes/cloudflare.js');
  await app.register(cloudflareRoutes, { cloudflareClient: deps.cloudflareClient });
  const { sentryRoutes } = await import('./routes/sentry.js');
  await app.register(sentryRoutes, { sentryClient: deps.sentryClient });
  const { grafanaRoutes } = await import('./routes/grafana.js');
  await app.register(grafanaRoutes, { grafanaClient: deps.grafanaClient });
  const { awsRoutes } = await import('./routes/aws.js');
  await app.register(awsRoutes, { awsClient: deps.awsClient });
  const { azureRoutes } = await import('./routes/azure.js');
  await app.register(azureRoutes, { azureClient: deps.azureClient });
  const { datadogRoutes } = await import('./routes/datadog.js');
  await app.register(datadogRoutes, { datadogClient: deps.datadogClient });
  const { dynatraceRoutes } = await import('./routes/dynatrace.js');
  await app.register(dynatraceRoutes, { dynatraceClient: deps.dynatraceClient });
  const { pagerdutyRoutes } = await import('./routes/pagerduty.js');
  await app.register(pagerdutyRoutes, { pagerdutyClient: deps.pagerdutyClient });
  const { gitlabRoutes } = await import('./routes/gitlab.js');
  await app.register(gitlabRoutes, { prefix: '/api', client: deps.gitlabClient });
  const { gitlabWebhookRoutes } = await import('./routes/gitlab-webhook.js');
  await app.register(gitlabWebhookRoutes, { prefix: '/api' });
  const { teamsRoutes } = await import('./routes/teams.js');
  await app.register(teamsRoutes, { prefix: '/api' });
  const { teamsMessagesRoutes } = await import('./routes/teams-messages.js');
  await app.register(teamsMessagesRoutes, { prefix: '/api', client: deps.teamsEventsClient, publish: deps.teamsPublish ?? deps.slackPublish, authenticate: deps.teamsAuthenticate });
  await app.register(projectRoutes, { githubClient: deps.githubClient, kgJobPublisher: deps.kgJobPublisher, slackClient: deps.slackClient, teamAutogenPublisher: deps.teamAutogenPublisher, embed: deps.embed });
  const { billingRoutes } = await import('./routes/billing.js');
  await app.register(billingRoutes);
  const { modelsRoutes } = await import('./routes/models.js');
  const { makeMcpListTools, makeGoogleIdTokenHeader } = await import('./integrations/mcp/gateway.js');
  const mcpUrl = app.config.MCP_GATEWAY_URL;
  await app.register(modelsRoutes, {
    listModels: deps.listModels,
    mcpListTools: deps.mcpListTools ?? makeMcpListTools(mcpUrl, mcpUrl ? makeGoogleIdTokenHeader(mcpUrl) : undefined),
  });
  const { conversationRoutes } = await import('./routes/conversations.js');
  await app.register(conversationRoutes);
  const { reportRoutes } = await import('./routes/reports.js');
  await app.register(reportRoutes);
  await app.register(workspaceRoutes);
  await app.register(signupRoutes);
  await app.register(invitationRoutes);
  const { integrationToolsRoutes } = await import('./routes/integration-tools.js');
  await app.register(integrationToolsRoutes, { client: deps.githubClient, slackClient: deps.slackClient, verifyServiceAuth: deps.verifyServiceAuth, gitlabClient: deps.gitlabClient });

  return app;
}
