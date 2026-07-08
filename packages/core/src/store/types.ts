// Row types for the Firestore data layer, mirroring the old Drizzle `$inferSelect` shapes.
// Source of truth: db/schema.ts (being retired). Keep field names + nullability in sync.

import type { TeamProposalDoc } from '../team/proposal-schema.js';
import type { Facts } from '../team/facts.js';

/** Billing band identifier — kept in core so the org type can reference it without a billing→core cycle. */
export type BillingBandId = 'indie' | 'startup' | 'scaleup' | 'enterprise';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  oidcClientSecret: string | null;
  idpTenantId: string | null;
  ssoProvider: string | null;
  ssoEnabled: boolean;
  pendingEmail: string | null;
  betaTester: boolean;
  kgEnabled: boolean;
  hindsightEnabled: boolean;
  showCostUsd: boolean;
  reportsEnabled: boolean;
  debugEnabled: boolean;
  approvalPolicy: { writeToolsRequireApproval: boolean; overrides?: Record<string, boolean> } | null;
  billingEnabled: boolean;
  billingBand: BillingBandId;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  aiSpendCapUsd: number | null;
  creditBalanceCents: number;
  createdAt: Date;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: 'owner' | 'manager' | 'user';
  createdAt: Date;
}

export interface OrgInvitation {
  id: string;
  orgId: string;
  email: string;
  role: 'owner' | 'manager' | 'user';
  invitedBy: string;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: Date;
  expiresAt: Date;
}

export interface Assistant {
  id: string;
  projectId: string;
  name: string;
  persona: string;
  model: string;
  provider: string | null;
  enabledTools: string[];
  isLead: boolean;
  sourceProposalId: string | null;
  userModified: boolean;
  graphX: number | null;
  graphY: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  approvalPolicy: { writeToolsRequireApproval: boolean; overrides?: Record<string, boolean> } | null;
  activeProposalId: string | null;
  // Per-project opt-in for GitHub issue creation. Docs created before the split lack
  // the field (undefined at runtime) — readers coalesce `issuesEnabled ?? copilotEnabled`.
  issuesEnabled: boolean;
  copilotEnabled: boolean;    // per-project opt-in for Copilot hand-off (requires issuesEnabled)
  reportsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

export interface ProjectRepo {
  id: string;
  projectId: string;
  orgIntegrationId: string;
  repoFullName: string;
  defaultBranch: string | null;
  refType: string | null;
  ref: string | null;
  addedByUserId: string;
  createdAt: Date;
}

export interface GithubRepoCatalogRow {
  id: string;
  orgIntegrationId: string;
  repoFullName: string;
  defaultBranch: string | null;
  private: boolean;
  syncedAt: Date;
}

export interface GithubCatalogSyncRow {
  orgIntegrationId: string;
  status: string;
  nextCursor: string | null;
  repoCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

export interface GitlabRepoCatalogRow {
  id: string;
  orgIntegrationId: string;
  repoFullName: string;       // GitLab path_with_namespace
  defaultBranch: string | null;
  private: boolean;
  syncedAt: Date;
}

export interface GitlabCatalogSyncRow {
  orgIntegrationId: string;
  status: 'idle' | 'syncing' | 'error';
  nextCursor: string | null;
  repoCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

export type GitlabEvents = { push: boolean; issues: boolean; mergeRequests: boolean };

export interface User {
  userId: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface GlobalSetting {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface QueuedTurn {
  id: string;
  laneId: string;
  orgId: string;
  source: 'slack' | 'teams' | 'web' | 'api' | 'internal';
  seq: number;
  status: 'queued' | 'running' | 'failed' | 'cancelled' | 'done';
  payload: unknown;
  attempts: number;
  /** Breaker-open deferrals (no provider call made). Bounded separately from `attempts` so a
   *  shared-breaker outage doesn't unfairly count against a turn, yet still can't loop forever. */
  deferrals: number;
  breakerKey: string | null;
  cancelRequested: boolean;
  error: unknown;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface BreakerRow {
  key: string;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  openedAt: Date | null;
  nextProbeAt: Date | null;
  updatedAt: Date;
}

export interface OrgModelKey {
  orgId: string;
  provider: string;
  keyCiphertext: string;
  keyHint: string;
  enabled: boolean;
  baseUrl: string | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgIntegration {
  id: string;
  orgId: string;
  provider: string;
  mode: string;
  baseUrl: string | null;
  accountLabel: string | null;
  secretCiphertext: string | null;
  secretHint: string | null;
  metadata: unknown;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  connectedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationInstallState {
  nonce: string;
  orgId: string;
  provider: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface IntegrationEvent {
  id: string;
  orgId: string;
  provider: string;
  category: string;
  eventType: string;
  action: string | null;
  deliveryId: string;
  repoFullName: string | null;
  actorLogin: string | null;
  mentionsBot: boolean;
  payload: unknown;
  receivedAt: Date;
  processed: boolean;
}

export interface Conversation {
  id: string;
  orgId: string;
  projectId: string;
  assistantId: string | null;
  systemAgentKey: string | null;
  rootConversationId: string | null;
  /** Immediate delegating conversation (the parent that spawned this sub-agent), set at spawn so
   *  the thread can show the handover the moment it happens — not only on parent resume. Null for
   *  roots and pre-2026-06 children (those fall back to the resume-time agent.* trace step). */
  parentConversationId: string | null;
  source: string;
  status: string;
  summary: string;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  teamsTenantId: string | null;
  teamsConversationId: string | null;
  createdAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  seq: number;
  role: string;
  content: string;
  slackUserId: string | null;
  teamsUserId: string | null;
  createdAt: Date;
}

export interface Operation {
  id: string;
  orgId: string;
  projectId: string | null;
  kind: string;
  parentConversationId: string | null;
  runConversationId: string | null;
  refId: string | null;
  status: string;
  costUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface TeamProposal {
  id: string;
  orgId: string;
  projectId: string;
  status: string;
  buildId: string | null;
  proposal: TeamProposalDoc | null;
  facts: Facts | null;
  version: number | null;
  progress: string | null;
  error: string | null;
  createdAt: Date;
  appliedAt: Date | null;
}

export interface AgentMemory {
  id: string;
  orgId: string;
  projectId: string;
  assistantId: string | null;
  scope: string;
  content: string;
  embedding: number[];
  usageCount: number;
  lastRecalledAt: Date | null;
  createdAt: Date;
}

export interface AgentSkill {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  description: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlackChannelBinding {
  id: string;
  orgIntegrationId: string;
  slackChannelId: string;
  channelName: string | null;
  projectId: string | null;
  status: string;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface TeamsChannelBinding {
  id: string;
  orgIntegrationId: string;
  teamsConversationId: string;
  channelName: string | null;
  projectId: string | null;
  status: string;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface GcpConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;
  secretCiphertext: string;
  secretHint: string | null;
  metadata: unknown;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GcpTarget {
  id: string;
  projectId: string;
  connectionId: string;
  gcpProjectId: string;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface GcpProjectConnection {
  id: string;
  orgId: string;
  projectId: string;
  connectionId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AwsConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;                 // 'access_key' | 'assume_role'
  awsAccountId: string | null;  // verified via STS GetCallerIdentity (or parsed from roleArn)
  defaultRegion: string;        // e.g. 'us-east-1'
  roleArn: string | null;       // assume_role mode
  externalId: string | null;    // assume_role mode (we generate; customer trusts)
  secretCiphertext: string;     // access_key: enc JSON {accessKeyId,secretAccessKey}; assume_role: ''
  secretHint: string | null;
  metadata: unknown;            // { availableSignals?: AwsSignal[] }
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AwsTarget {
  id: string;
  projectId: string;
  connectionId: string;
  awsAccountId: string;
  awsRegion: string;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface AzureConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;                      // 'service_principal' | 'workload_identity'
  tenantId: string;                  // Entra directory (tenant) id
  clientId: string;                  // Entra app (client) id
  secretCiphertext: string;          // service_principal: enc client secret; workload_identity: ''
  secretHint: string | null;         // service_principal: last 4 of clientId
  federationSubject: string | null;  // workload_identity: subject we generate; customer trusts
  defaultSubscriptionId: string;     // used at verify time to probe metrics/alerts (analog of AWS defaultRegion)
  defaultWorkspaceId: string | null; // used at verify time to probe logs/traces
  metadata: unknown;                 // { availableSignals?: AzureSignal[] }
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AzureTarget {
  id: string;
  projectId: string;
  connectionId: string;
  subscriptionId: string;                 // metrics + alerts scope (ARM)
  logAnalyticsWorkspaceId: string | null; // logs + traces scope (workspace GUID / customerId)
  region: string | null;                  // optional default Azure region, e.g. 'eastus'
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface DatadogConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;                 // 'api_keys'
  site: string;                 // 'us1' | 'us3' | 'us5' | 'eu' | 'ap1' | 'us1-fed'
  secretCiphertext: string;     // encrypted JSON { apiKey, appKey }
  secretHint: string | null;    // '…'+last4 of appKey
  metadata: unknown;            // { availableSignals?: DatadogSignal[] }
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatadogTarget {
  id: string;
  projectId: string;
  connectionId: string;
  env: string;
  service: string | null;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface PagerDutyConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;                 // 'api_keys'
  region: string;               // 'us' | 'eu'
  secretCiphertext: string;     // encrypted API token (raw string)
  secretHint: string | null;    // '…'+last4 of token
  metadata: unknown;            // { availableSignals?: PagerDutySignal[] }
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PagerDutyTarget {
  id: string;
  projectId: string;
  connectionId: string;
  teamId: string | null;
  teamName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface DynatraceConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;                 // 'api_token'
  environmentUrl: string;       // e.g. https://abc12345.live.dynatrace.com
  secretCiphertext: string;     // encrypted API token (raw string)
  secretHint: string | null;    // '…'+last4 of token
  metadata: unknown;            // { availableSignals?: DynatraceSignal[] }
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DynatraceTarget {
  id: string;
  projectId: string;
  connectionId: string;
  managementZone: string | null;
  service: string | null;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface CloudflareConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;
  secretCiphertext: string;
  metadata: unknown;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CloudflareTarget {
  id: string;
  projectId: string;
  connectionId: string;
  kind: string;
  accountId: string;
  zoneId: string | null;
  name: string;
  label: string | null;
  workerScripts: unknown;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface CloudflareProjectConnection {
  id: string;
  orgId: string;
  projectId: string;
  connectionId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SentryConnection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  mode: string;
  /** Sentry API base, e.g. https://sentry.io (or a self-hosted host). */
  baseUrl: string;
  secretCiphertext: string;
  secretHint: string | null;
  metadata: unknown;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SentryTarget {
  id: string;
  projectId: string;
  connectionId: string;
  /** The allowed Sentry project's slug (the scope key the tools check against). */
  sentryProjectSlug: string;
  sentryProjectId: string;
  name: string;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface SentryProjectConnection {
  id: string;
  orgId: string;
  projectId: string;
  connectionId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type GrafanaSignal = 'metrics' | 'logs' | 'traces';

/** A Grafana datasource we can query (one of the supported types). */
export interface GrafanaDatasourceRef {
  uid: string;
  name: string;
  type: string; // raw Grafana type: 'prometheus' | 'loki' | 'tempo'
}

export interface GrafanaConnection {
  id: string;
  orgId: string;
  projectId: string | null; // null = org-shared; set = project-owned (private)
  name: string;
  mode: string; // 'grafana' in v1; 'direct' reserved
  /** Grafana instance base, e.g. https://grafana.acme.io */
  baseUrl: string;
  secretCiphertext: string;
  secretHint: string | null;
  /** { grafanaOrgName?, availableSignals?: GrafanaSignal[], datasources?: GrafanaDatasourceRef[] } */
  metadata: unknown;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GrafanaTarget {
  id: string;
  projectId: string;
  connectionId: string;
  /** The allowed datasource's uid (the scope key the tools check against). */
  datasourceUid: string;
  datasourceType: string; // 'prometheus' | 'loki' | 'tempo'
  name: string;
  label: string | null;
  metadata: unknown;
  addedByUserId: string;
  createdAt: Date;
}

export interface GrafanaProjectConnection {
  id: string;
  orgId: string;
  projectId: string;
  connectionId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Trace {
  id: string;
  orgId: string;
  conversationId: string | null;
  turnId: string | null;
  source: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
  modelCallCount: number;
  toolCallCount: number;
  otelTraceId: string | null;
}

export interface TraceStep {
  id: string;
  traceId: string;
  type: string;
  name: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  error: string | null;
  argsPreview: string | null;
  resultPreview: string | null;
  args: string | null;
  result: string | null;
  truncated: boolean;
  childConversationId: string | null;
}

export interface AgentRun {
  id: string;
  turnId: string;
  laneId: string;
  orgId: string;
  status: string;
  messages: unknown;
  pendingCalls: unknown;
  results: Record<string, { result: string; childConversationId?: string }>;
  model: string;
  enabledTools: string[];
  slack: unknown;
  otelTraceId: string | null;
  depth: number;
  approvedBy: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface McpServer {
  id: string;
  orgId: string;
  name: string;
  url: string;
  authType: string;
  secretCiphertext: string | null;
  enabled: boolean;
  createdAt: Date;
}

export interface KgBuild {
  id: string;
  orgId: string;
  repoFullName: string;
  commitSha: string | null;
  projectId: string | null;
  phase: string | null;
  mode: string;
  status: string;
  nodesAnalyzed: number;
  tokens: number;
  costCredits: number;
  truncated: boolean;
  note: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface KgNode {
  id: string;
  orgId: string;
  buildId: string;
  repoFullName: string;
  kind: string;
  name: string;
  businessFlow: string | null;
  digest: string | null;
  codeRefPath: string | null;
  codeRefStart: number | null;
  codeRefEnd: number | null;
  commitSha: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface KgEdge {
  id: string;
  orgId: string;
  buildId: string;
  srcNodeId: string;
  dstNodeId: string;
  relation: string;
}

export interface KgNodeEmbedding {
  nodeId: string;
  buildId: string;
  embedding: number[];
}

export interface ModelInvocation {
  id: string;
  orgId: string | null;
  source: string;
  model: string;
  provider: string | null;
  conversationId: string | null;
  buildId: string | null;
  operationId: string | null;
  phase: string | null;
  messages: unknown[] | null;
  output: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  /** True when this call failed with a provider rate-limit (HTTP 429) — powers the
   *  "rate-limited" signal on AI Activity and surfaces every attempt, not just give-ups. */
  rateLimited: boolean;
  truncated: boolean;
  createdAt: Date;
}

export interface CopilotIssueOffer {
  id: string;
  orgId: string;
  projectId: string;
  provider: 'github' | 'gitlab';
  conversationId: string;
  slackChannelId: string;
  slackThreadTs: string;
  slackMessageTs: string | null;
  repo: string | null;
  candidateRepos: string[];
  title: string;
  body: string;
  summary: string;
  status: 'offered' | 'creating' | 'created' | 'declined' | 'failed';
  issueNumber: number | null;
  issueUrl: string | null;
  copilotAssigned: boolean;
  error: string | null;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface ConversationReport {
  id: string;
  conversationId: string;
  orgId: string;
  projectId: string;
  version: number;
  html: string;
  model: string | null;
  costUsd: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ReportOffer {
  id: string;
  orgId: string;
  projectId: string;
  conversationId: string;
  slackChannelId: string;
  slackThreadTs: string;
  slackMessageTs: string | null;
  status: 'offered' | 'generating' | 'generated' | 'declined' | 'failed';
  reportId: string | null;
  reportUrl: string | null;
  error: string | null;
  decidedBy: string | null;
  createdAt: Date;
}
