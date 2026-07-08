export { encryptSecret, decryptSecret, keyFromBase64 } from './crypto/secrets.js';
export { hashPassword, verifyPassword } from './crypto/password.js';
export { createStore, type Store, type StoreConfig, type Db } from './store/firestore.js';
export { col } from './store/collections.js';
export { toDoc, fromDoc, applyDefaults, FieldValue } from './store/codec.js';
export { VertexVectorIndex, FirestoreVectorIndex, InMemoryVectorIndex, DisabledVectorIndex, vectorConfigured, type VectorIndex, type VectorPoint, type Neighbor, type VertexVectorConfig } from './store/vector.js';
export { createDb, type LegacyDb } from './db/client.js';
export * as schema from './db/schema.js';
export type { Organization, BillingBandId } from './store/types.js';
export type { OrgMember, OrgInvitation, Assistant, User, Project, ProjectMember, ApiKey } from './db/schema.js';
export { projects, projectMembers, projectRole } from './db/schema.js';
export {
  createOrgWithOwner, listOrgsForUser, getMembership, getOrgBySlug, getOrgById, getOrgByStripeCustomerId, listOrgMembers, setOrgRole,
  createPendingOrg, deleteOrg, setOrgClientSecret, setOrgSso, setOrgIdpTenant, activateOrg, addOrgOwner, addOrgMember,
  listAllOrgs, setOrgBetaTester, setOrgKgEnabled, setOrgHindsightEnabled, setOrgShowCostUsd, setOrgReportsEnabled, setOrgDebugEnabled,
  setOrgBillingState,
  type OrgMemberWithEmail, type OrgSummary,
} from './repos/orgs.js';
export {
  createInvitation, listPendingInvitations, getInvitation, revokeInvitation, acceptInvitation,
  type InviteRole,
} from './repos/invitations.js';
export {
  createAssistant, listAssistants, getAssistant, getProjectOrchestrator, updateAssistant, deleteAssistant,
  deleteAutogenAssistants, markAssistantUserModified,
  type AssistantInput,
} from './repos/assistants.js';
export {
  ensureDefaultProject, createProject, getProject, getProjectBySlug, renameProject,
  updateProject, setProjectIssuesEnabled, setProjectReportsEnabled, deleteProject, listProjectsForOrg, listManageableProjects, projectScopeCounts, getProjectOrgId,
} from './repos/projects.js';
export {
  getProjectRole, listProjectMembers, addProjectMember, setProjectRole, removeProjectMember, userIdByEmail,
  type ProjectMemberWithEmail,
} from './repos/project-members.js';
export {
  listProjectRepos, addProjectRepo, removeProjectRepo, type AddProjectRepoInput,
  setProjectRepoRef, resolveRepoRef, type RepoRef,
} from './repos/project-repos.js';
export {
  listGcpTargets, addGcpTarget, removeGcpTarget, gcpTargetExists,
  setGcpTargetSignals, toPublicGcpTarget,
  type AddGcpTargetInput, type GcpTargetPublic, type GcpTargetMetadata,
} from './repos/gcp-targets.js';
export type { GcpTarget } from './db/schema.js';
export { gcpTargets } from './db/schema.js';
export * from './repos/users.js';
export {
  getGlobalSetting, setGlobalSetting, getPlanLimits, setPlanLimits, PLAN_LIMITS_KEY,
  type PlanLimits, type AllPlanLimits,
} from './repos/global-settings.js';
export {
  hashApiKey, generateApiKey, createApiKey, listApiKeys, revokeApiKey,
  findActiveApiKeyByHash, touchApiKeyLastUsed, type ApiKeyPublic,
} from './repos/api-keys.js';
export {
  enqueueTurn, claimNextTurn, markTurnDone, markTurnFailed, markTurnCancelled,
  requeueTurn, requestCancel, isCancelRequested, getTurn, listLaneQueue, listActiveTurns, peekNextQueued,
  type TurnSource, type EnqueueInput,
} from './repos/message-queue.js';
export { getBreaker, saveBreaker, recordBreakerFailure, type SaveBreakerInput, type BreakerStateKind } from './repos/breaker-state.js';
export {
  setModelKey, setModelKeyEnabled, listModelKeys, deleteModelKey,
  getEnabledKeyCiphertext, hasEnabledModelKey, getKeyCiphertext, setModelKeyTested,
  type ModelKeyPublic,
} from './repos/org-model-keys.js';
export type { OrgModelKey } from './db/schema.js';
export type { QueuedTurn, BreakerRow } from './db/schema.js';
export {
  upsertIntegration, getIntegration, getIntegrationByInstallationId, getIntegrationByTeamId, setIntegrationTested,
  setIntegrationEvents, setIntegrationIssuesEnabled, deleteIntegration, createInstallState, consumeInstallState, toPublicIntegration,
  insertIntegrationEvent, disableIntegrationByInstallationId,
  getIntegrationByWebhookTokenHash, setGitlabIntegrationEvents,
  getIntegrationByTenantId, upsertTeamsIntegration,
  type IntegrationEvents, type IntegrationMetadata, type OrgIntegrationPublic, type UpsertIntegrationInput,
  type InsertEventInput,
} from './repos/org-integrations.js';
export type { GitlabEvents } from './store/types.js';
export type { OrgIntegration, IntegrationInstallState, IntegrationEvent } from './db/schema.js';
export {
  searchCatalog, getCatalogRepo, upsertCatalogRepo, removeCatalogRepo,
  type CatalogRepo, type SearchCatalogResult,
} from './repos/github-catalog.js';
export {
  getSyncState, startSync, recordPage, markDone, markError, isCatalogStale,
} from './repos/github-catalog-sync.js';
// ── GitLab (source-code integration; Firestore-only) ──
export {
  realGitlabClient, makeGitlabClientForTest, apiBaseFor as gitlabApiBaseFor, gitlabCredsForRow,
  type GitlabClient, type GitlabCreds, type GitlabProbeResult,
} from './gitlab/client.js';
export { isGitlabIssueCreationEnabled } from './gitlab/gate.js';
export {
  searchGitlabCatalog, getGitlabCatalogRepo, upsertGitlabCatalogRepo, removeGitlabCatalogRepo,
  type GitlabCatalogRepo, type GitlabSearchCatalogResult,
} from './repos/gitlab-catalog.js';
export {
  getGitlabSyncState, startGitlabSync, recordGitlabPage, markGitlabDone, markGitlabError, isGitlabCatalogStale,
} from './repos/gitlab-catalog-sync.js';
export {
  findOrCreateSlackConversation, getSlackConversation, getConversation, getSlackRootTarget,
  appendConversationMessage, listConversationMessages, createConversation,
  listConversationsForProject,
  listRootConversations, incidentRollup, countChildConversations, getConversationTree, listActivity,
  setConversationSummary, upsertSummaryEmbedding, searchRecentSummaries,
  listTreeAssistantIds, listConversationSummaries,
  findOrCreateTeamsConversation, getTeamsConversation, getTeamsRootTarget,
  type FindOrCreateInput, type FindOrCreateTeamsInput, type AppendMessageInput, type ActivityRow, type ConversationSummary,
} from './repos/conversations.js';
export type { Conversation, ConversationMessage, SlackChannelBinding } from './db/schema.js';
export {
  getBinding, upsertPendingBinding, setBinding, listBindings, deleteBinding,
  listBindingsForProject, listSlackBindingsByProject, listAvailableBindings,
} from './repos/slack-channel-bindings.js';
export {
  getBinding as getTeamsBinding, upsertPendingTeamsBinding, setTeamsBinding,
  listTeamsBindings, listTeamsBindingsForProject, listTeamsBindingsByProject,
  listAvailableTeamsBindings, deleteTeamsBinding,
} from './repos/teams-channel-bindings.js';
export type { TeamsChannelBinding } from './store/types.js';
export {
  realSlackClient, makeSlackClientForTest, type SlackClient,
  type SlackOauthInput, type SlackOauthResult, type SlackAuthTestResult, type SlackChatResult,
} from './slack/client.js';
export { realTeamsClient, makeTeamsClientForTest, type TeamsClient, type TeamsAuth, type TeamsSendInput, type TeamsSendResult, type ConnectorFactory, type ConnectorLike } from './teams/client.js';
export {
  markdownToBlocks, markdownToFallbackText, type SlackBlock,
} from './slack/markdown-blocks.js';
export {
  createTrace, addTraceStep, startTraceStep, finishTraceStep, finalizeTrace, listTraceSteps, getTrace,
  listTracesByConversationId,
  type NewTrace, type NewTraceStep, type TraceRollup,
} from './repos/traces.js';
export type { Trace, TraceStep } from './db/schema.js';
export { createAgentRun, getAgentRun, markAgentRunResolved, resolveAgentRunIfSuspended, recordAgentRunResult, listSuspendedRuns, type NewAgentRun } from './repos/agent-runs.js';
export { getOrgApprovalPolicy, getProjectApprovalPolicy, setProjectApprovalPolicy, type ApprovalPolicy } from './repos/approval-policy.js';
export type { AgentRun } from './db/schema.js';
export { forecastTeamCost, type AgentForecastInput, type TeamForecast, type TierForecast } from './team/forecast.js';
export {
  createMcpServer, listMcpServers, getMcpServer, setMcpServerEnabled, mcpServerToken,
  type NewMcpServer,
} from './repos/mcp-servers.js';
export type { McpServer } from './db/schema.js';
export {
  createBuild, finishBuild, startBuildOperation, insertNodes, insertEdges, deleteBuildNodesByKind, insertEmbeddings, deleteBuildEmbeddings, updateNodeDigests, getCurrentBuildId,
  getLatestBuild, getLatestProjectBuild, buildBelongsToProject,
  getFlows, getNode, walkthrough, blastRadius, findFlowBySemantic, recentChangesNear, getGraph,
  setBuildPhase, addBuildTokens, getCurrentProjectBuildId, getProjectGraph, getProjectFlows, getChildren, getParents,
  type NewNode, type NewEdge, type BuildMode, type Graph, type GraphNode, type GraphEdge,
} from './repos/knowledge-graph.js';
export {
  startOperation, startOrReuseOperation, finishOperation, getOperation, setOperationConversation,
  type StartOperationInput,
} from './repos/operations.js';
export {
  startRcaRun, finishRcaRun, incidentCost,
  type StartRcaRunInput, type StartRcaRunResult, type FinishRcaRunInput,
} from './repos/rca-runs.js';
export type { Operation } from './db/schema.js';
export type { KgBuild, KgNode, KgEdge, KgNodeEmbedding } from './db/schema.js';
export { type KgBuildJob, type KgJobPublisher } from './repos/kg-jobs.js';
export { type TeamAutogenJob, type TeamAutogenPublisher } from './repos/team-autogen-jobs.js';
export { type ReportGenJob, type ReportGenPublisher } from './repos/report-gen-jobs.js';
export type { InvocationCostHook } from './ports/billing-hook.js';
export {
  recordModelInvocation, startModelInvocation, finishModelInvocation, listModelInvocations, getModelInvocation, listFullModelInvocations,
  type NewModelInvocationInput, type StartModelInvocationInput, type CompactInvocationRow,
} from './repos/model-invocations.js';
export type { ModelInvocation, NewModelInvocation } from './db/schema.js';
export {
  buildOperationTimeline, buildConversationTimeline,
  type RunStep, type RunTimeline,
} from './telemetry/run-timeline.js';
export * from './models/catalog.js';
export { MODEL_PRICES, type ModelPrice } from './models/pricing.js';
export { assertSafeBaseUrl } from './security/ssrf.js';
export {
  realGithubClient, makeGithubClientForTest, apiBaseFor, appJwt, graphqlUrlFor, credsForRow,
  type GithubClient, type Creds, type AppCreds, type PatCreds,
  type GithubProbeResult, type CatalogRepoDetail,
} from './github/client.js';
export { credsForConnection, mintToken, mintAmbientToken, GCP_READONLY_SCOPES, GCP_ERRORREPORTING_SCOPES, type GcpCreds, type MintDeps, type AmbientDeps } from './gcp/auth.js';
export { realGcpClient, makeGcpClientForTest, resolveWindow, windowToPeriod, type GcpClient, type ReportedErrorEvent } from './gcp/client.js';
export { probeSignals, SIGNAL_TOOLS, type GcpSignal, type SignalResult, type SignalReport } from './gcp/probe.js';
export { errorRatePromQL, latencyPromQL, logErrorFilter } from './gcp/recipes.js';
export { validateGcpScope, type GcpAllowed, type GcpScopeResult } from './gcp/validate.js';
export {
  listCloudflareTargets, addCloudflareTarget, updateCloudflareTarget, removeCloudflareTarget,
  cloudflareTargetExists, toPublicCloudflareTarget, setCloudflareTargetSignals,
  type AddCloudflareTargetInput, type CloudflareTargetPublic, type CloudflareTargetMetadata,
} from './repos/cloudflare-targets.js';
export type { CloudflareTarget } from './db/schema.js';
export { cloudflareTargets } from './db/schema.js';
export {
  listConnectionsForProject, listOrgConnections, getConnection, addConnection, updateConnection, deleteConnection,
  toPublicCloudflareConnection,
  type AddCloudflareConnectionInput, type CloudflareConnectionPublic, type CloudflareConnectionMetadata,
} from './repos/cloudflare-connections.js';
export type { CloudflareConnection } from './db/schema.js';
export { cloudflareConnections } from './db/schema.js';
export {
  listOrgConnections as listGcpOrgConnections,
  listConnectionsForProject as listGcpConnectionsForProject,
  getConnection as getGcpConnection,
  addConnection as addGcpConnection,
  updateConnection as updateGcpConnection,
  deleteConnection as deleteGcpConnection,
  toPublicGcpConnection,
  type AddGcpConnectionInput, type GcpConnectionPublic, type GcpConnectionMetadata,
} from './repos/gcp-connections.js';
export {
  getProjectConnection as getGcpProjectConnection,
  setProjectConnection as setGcpProjectConnection,
  deleteProjectConnection as deleteGcpProjectConnection,
} from './repos/gcp-project-connections.js';
export type { GcpConnection, GcpProjectConnection } from './db/schema.js';
export {
  listOrgConnections as listAwsOrgConnections,
  listConnectionsForProject as listAwsConnectionsForProject,
  getConnection as getAwsConnection,
  addConnection as addAwsConnection,
  updateConnection as updateAwsConnection,
  deleteConnection as deleteAwsConnection,
  toPublicAwsConnection,
  type AddAwsConnectionInput, type AwsConnectionPublic, type AwsConnectionMetadata,
} from './repos/aws-connections.js';
export type { AwsConnection, AwsTarget } from './store/types.js';
export {
  listOrgConnections as listAzureOrgConnections,
  listConnectionsForProject as listAzureConnectionsForProject,
  getConnection as getAzureConnection,
  addConnection as addAzureConnection,
  updateConnection as updateAzureConnection,
  deleteConnection as deleteAzureConnection,
  toPublicAzureConnection,
  type AddAzureConnectionInput, type AzureConnectionPublic, type AzureConnectionMetadata,
} from './repos/azure-connections.js';
export type { AzureConnection, AzureTarget } from './store/types.js';
export {
  listAwsTargets, addAwsTarget, removeAwsTarget, awsTargetExists, toPublicAwsTarget,
  type AddAwsTargetInput, type AwsTargetPublic,
} from './repos/aws-targets.js';
export {
  listAzureTargets, addAzureTarget, removeAzureTarget, removeAzureTargetsForConnection,
  azureTargetExists, toPublicAzureTarget,
  type AddAzureTargetInput, type AzureTargetPublic,
} from './repos/azure-targets.js';
// ── Datadog (read-only observability; Firestore-only, no Drizzle mirror) ──
export {
  listOrgConnections as listDatadogOrgConnections,
  listConnectionsForProject as listDatadogConnectionsForProject,
  getConnection as getDatadogConnection,
  addConnection as addDatadogConnection,
  updateConnection as updateDatadogConnection,
  deleteConnection as deleteDatadogConnection,
  toPublicDatadogConnection,
  type AddDatadogConnectionInput, type DatadogConnectionPublic, type DatadogConnectionMetadata,
} from './repos/datadog-connections.js';
export type { DatadogConnection, DatadogTarget } from './store/types.js';
export {
  listDatadogTargets, addDatadogTarget, removeDatadogTarget, removeDatadogTargetsForConnection,
  datadogTargetExists, toPublicDatadogTarget,
  type AddDatadogTargetInput, type DatadogTargetPublic,
} from './repos/datadog-targets.js';
export { credsForConnection as credsForDatadogConnection, siteBaseUrl, ddHeaders, type DatadogCreds, type DatadogSite } from './datadog/auth.js';
export { realDatadogClient, makeDatadogClientForTest, resolveWindow as resolveDatadogWindow, type DatadogClient, type DatadogWindow } from './datadog/client.js';
export { probeSignals as probeDatadogSignals, SIGNAL_TOOLS as DATADOG_SIGNAL_TOOLS, type DatadogSignal, type DatadogSignalReport } from './datadog/probe.js';
export { datadogScopeKey, validateDatadogScope, tagFilter as datadogTagFilter, logErrorQuery as datadogLogErrorQuery, spanErrorQuery as datadogSpanErrorQuery, metricQuery as datadogMetricQuery, type DatadogAllowed } from './datadog/recipes.js';
// ── PagerDuty (read-only incident integration; Firestore-only, no Drizzle mirror) ──
export {
  listOrgConnections as listPagerDutyOrgConnections,
  listConnectionsForProject as listPagerDutyConnectionsForProject,
  getConnection as getPagerDutyConnection,
  addConnection as addPagerDutyConnection,
  updateConnection as updatePagerDutyConnection,
  deleteConnection as deletePagerDutyConnection,
  toPublicPagerDutyConnection,
  type AddPagerDutyConnectionInput, type PagerDutyConnectionPublic, type PagerDutyConnectionMetadata,
} from './repos/pagerduty-connections.js';
export type { PagerDutyConnection, PagerDutyTarget } from './store/types.js';
export {
  listPagerDutyTargets, addPagerDutyTarget, removePagerDutyTarget, removePagerDutyTargetsForConnection,
  pagerdutyTargetExists, toPublicPagerDutyTarget,
  type AddPagerDutyTargetInput, type PagerDutyTargetPublic,
} from './repos/pagerduty-targets.js';
export { credsForConnection as credsForPagerDutyConnection, pdBaseUrl, pdHeaders, type PagerDutyCreds, type PagerDutyRegion } from './pagerduty/auth.js';
export { realPagerDutyClient, makePagerDutyClientForTest, type PagerDutyClient, type ListIncidentsParams } from './pagerduty/client.js';
export { probeSignals as probePagerDutySignals, SIGNAL_TOOLS as PAGERDUTY_SIGNAL_TOOLS, type PagerDutySignal, type PagerDutySignalReport } from './pagerduty/probe.js';
export { pagerdutyScopeKey, validatePagerDutyScope, targetsToFilter as targetsToPagerDutyFilter, defaultIncidentWindow, type PagerDutyAllowed } from './pagerduty/recipes.js';
// ── Dynatrace (read-only observability; Firestore-only, no Drizzle mirror) ──
export {
  listOrgConnections as listDynatraceOrgConnections,
  listConnectionsForProject as listDynatraceConnectionsForProject,
  getConnection as getDynatraceConnection,
  addConnection as addDynatraceConnection,
  updateConnection as updateDynatraceConnection,
  deleteConnection as deleteDynatraceConnection,
  toPublicDynatraceConnection,
  type AddDynatraceConnectionInput, type DynatraceConnectionPublic, type DynatraceConnectionMetadata,
} from './repos/dynatrace-connections.js';
export type { DynatraceConnection, DynatraceTarget } from './store/types.js';
export {
  listDynatraceTargets, addDynatraceTarget, removeDynatraceTarget, removeDynatraceTargetsForConnection,
  dynatraceTargetExists, toPublicDynatraceTarget,
  type AddDynatraceTargetInput, type DynatraceTargetPublic,
} from './repos/dynatrace-targets.js';
export { credsForConnection as credsForDynatraceConnection, apiBase as dynatraceApiBase, dtHeaders, type DynatraceCreds } from './dynatrace/auth.js';
export { realDynatraceClient, makeDynatraceClientForTest, resolveWindow as resolveDynatraceWindow, type DynatraceClient, type DynatraceWindow } from './dynatrace/client.js';
export { probeSignals as probeDynatraceSignals, SIGNAL_TOOLS as DYNATRACE_SIGNAL_TOOLS, type DynatraceSignal, type DynatraceSignalReport } from './dynatrace/probe.js';
export {
  dynatraceScopeKey, validateDynatraceScope,
  entitySelector as dynatraceEntitySelector, logErrorQuery as dynatraceLogErrorQuery,
  metricSelector as dynatraceMetricSelector, SERVICE_LATENCY_METRIC, SERVICE_ERROR_RATE_METRIC,
  type DynatraceAllowed,
} from './dynatrace/recipes.js';
export { getProjectConnection, setProjectConnection, deleteProjectConnection } from './repos/cloudflare-project-connections.js';
export type { CloudflareProjectConnection } from './db/schema.js';
export { cloudflareProjectConnections } from './db/schema.js';
export { credsForConnection as cfCredsForConnection, authHeaders as cfAuthHeaders, type CloudflareCreds } from './cloudflare/auth.js';
export { httpErrorSummary, latencySummary, firewallEvents, workerErrors } from './cloudflare/recipes.js';
export { realCloudflareClient, makeCloudflareClientForTest, type CloudflareClient } from './cloudflare/client.js';
export {
  probeSignals as cfProbeSignals, CF_SIGNAL_TOOLS,
  type CloudflareSignal, type CloudflareSignalReport, type ProbeTarget as CfProbeTarget,
} from './cloudflare/probe.js';
export { validateGraphqlScope, validateGraphqlScopes, type CfScope, type CfAllowed } from './cloudflare/validate.js';
// ── Sentry (read-only observability; Firestore-only, no Drizzle mirror) ──
export {
  listConnectionsForProject as listSentryConnectionsForProject,
  listOrgConnections as listSentryOrgConnections,
  getConnection as getSentryConnection,
  addConnection as addSentryConnection,
  updateConnection as updateSentryConnection,
  deleteConnection as deleteSentryConnection,
  toPublicSentryConnection,
  type AddSentryConnectionInput, type SentryConnectionPublic, type SentryConnectionMetadata,
} from './repos/sentry-connections.js';
export {
  listSentryTargets, sentryTargetExists, addSentryTarget, removeSentryTarget, toPublicSentryTarget,
  type AddSentryTargetInput, type SentryTargetPublic, type SentryTargetMetadata,
} from './repos/sentry-targets.js';
export {
  getProjectConnection as getSentryProjectConnection,
  setProjectConnection as setSentryProjectConnection,
  deleteProjectConnection as deleteSentryProjectConnection,
} from './repos/sentry-project-connections.js';
export type { SentryConnection, SentryTarget, SentryProjectConnection } from './store/types.js';
export { credsForConnection as sentryCredsForConnection, authHeaders as sentryAuthHeaders, type SentryCreds } from './sentry/auth.js';
// ── Grafana (read-only observability; Firestore-only, no Drizzle mirror) ──
export {
  listConnectionsForProject as listGrafanaConnectionsForProject,
  listOrgConnections as listGrafanaOrgConnections,
  getConnection as getGrafanaConnection,
  addConnection as addGrafanaConnection,
  updateConnection as updateGrafanaConnection,
  deleteConnection as deleteGrafanaConnection,
  toPublicGrafanaConnection,
  type AddGrafanaConnectionInput, type GrafanaConnectionPublic, type GrafanaConnectionMetadata,
} from './repos/grafana-connections.js';
export {
  listGrafanaTargets, grafanaTargetExists, addGrafanaTarget, removeGrafanaTarget, toPublicGrafanaTarget,
  type AddGrafanaTargetInput, type GrafanaTargetPublic, type GrafanaTargetMetadata,
} from './repos/grafana-targets.js';
export {
  getProjectConnection as getGrafanaProjectConnection,
  setProjectConnection as setGrafanaProjectConnection,
  deleteProjectConnection as deleteGrafanaProjectConnection,
} from './repos/grafana-project-connections.js';
export type { GrafanaConnection, GrafanaTarget, GrafanaProjectConnection, GrafanaSignal, GrafanaDatasourceRef } from './store/types.js';
export { credsForConnection as grafanaCredsForConnection, authHeaders as grafanaAuthHeaders, type GrafanaCreds } from './grafana/auth.js';
export {
  credsForConnection as credsForAzureConnection,
  resolveAzureCredential,
  type AzureCreds, type AzureAuthConfig, type AzureAuthDeps,
} from './azure/auth.js';
export { realAzureClient, makeAzureClientForTest, resolveWindow as resolveAzureWindow, type AzureClient, type AzureWindow, type MetricQuery as AzureMetricQuery } from './azure/client.js';
export { probeSignals as probeAzureSignals, SIGNAL_TOOLS as AZURE_SIGNAL_TOOLS, type AzureSignal, type AzureSignalReport } from './azure/probe.js';
export {
  azureScopeKey, validateAzureScope,
  usageTablesKql, logErrorKql, errorRateKql, latencyKql, listTracesKql, getTraceKql,
  type AzureAllowed,
} from './azure/recipes.js';
export { realGrafanaClient, makeGrafanaClientForTest, resolveWindow as resolveGrafanaWindow, type GrafanaClient, type GrafanaDatasource, type GrafanaWindow } from './grafana/client.js';
export { discoverDatasources as discoverGrafanaDatasources, signalForType as grafanaSignalForType, type DiscoveryResult as GrafanaDiscoveryResult } from './grafana/probe.js';
export { errorRatePromQL as grafanaErrorRatePromQL, latencyPromQL as grafanaLatencyPromQL, logErrorLogQL as grafanaLogErrorLogQL } from './grafana/recipes.js';
export { realSentryClient, makeSentryClientForTest, type SentryClient, type SentryListIssuesOpts } from './sentry/client.js';
export {
  createTeamProposal, getActiveTeamProposal, getLatestTeamProposal, getTeamProposal,
  setTeamProposalStatus, saveTeamProposalResult, markTeamProposalApplied, setTeamProposalProgress, setTeamProposalFacts,
  listTeamVersions, getProjectActiveProposalId, setProjectActiveProposal, type TeamVersion,
} from './repos/team-proposals.js';
export { TEAM_AUTOGEN_PHASES, type TeamAutogenPhase } from './team/phases.js';
export {
  ANALYSIS_FLEET, getAnalysisAgent, listAnalysisAgents, selectFleet, type AnalysisAgent,
} from './team/analysis-fleet/registry.js';
export { TeamProposalSchema, normalizeProposal, type TeamProposalDoc, type ProposedAssistant, type TeamGap } from './team/proposal-schema.js';
export type { TeamProposal } from './db/schema.js';
export { applyTeamProposal } from './team/apply-proposal.js';
export { RCA_OPERATING_PREAMBLE } from './team/rca-preamble.js';
export { buildKgSummary, renderKgSummary } from './team/kg-summary.js';
export {
  listSignalSkills, registerSignalSkill, detectSignalsFromSnapshot,
  type SignalSkill, type SignalSpec, type SignalFinding, type RepoSnapshot,
  type SignalKind, type SignalIntegration,
} from './signals/index.js';
export { getConnectedIntegrations, renderInventory, type ConnectedIntegrations } from './team/integration-inventory.js';
export { recallMemories, addTeamMemory, listMemories, deleteMemory, addPrivateMemory, listPrivateMemories, deletePrivateMemory } from './repos/agent-memories.js';
export { createSkill, listSkills, updateSkill, deleteSkill, listAttachedSkills, setAttachedSkills, loadSkillBody } from './repos/agent-skills.js';
export { renderSkillsBlock, withSkillTool } from './team/skill-prompt.js';
export type { AgentMemory } from './db/schema.js';
export { summarizeConversation, type SummarizeDeps, type SummarizeInput, type SummarizeResult } from './conversations/summarize.js';
export { getSystemAgent, listSystemAgents, type SystemAgent } from './system-agents/registry.js';
export { computeGaps, type Facts, type ConnectedSignalIntegrations } from './team/facts.js';
export {
  startTracing, getTracer, makeLogger, type LoggerOptions,
  injectTraceContext, extractTraceContext, injectTraceHeaders, XTraceIdPropagator,
} from './observability/index.js';
export {
  buildConversationThread, colorFor, THREAD_PALETTE, HUMAN_COLOR,
  type ConversationThread, type ThreadEvent, type Participant, type ParticipantRole,
} from './conversations/thread.js';
export { isReportGenerationEnabled } from './reports/gate.js';
export { REPORT_STYLE_PROMPT } from './reports/style-prompt.js';
export {
  serializeThread, stripCodeFences, generateReportHtml,
  type GenerateReportDeps, type GenerateReportInput,
} from './reports/generate.js';
export { isIssueCreationEnabled } from './copilot/gate.js';
export {
  createCopilotIssueOffer, getCopilotIssueOffer, getUnpostedOfferForConversation, setCopilotIssueOfferMessageTs,
  claimCopilotIssueOffer, declineCopilotIssueOffer, markCopilotIssueOfferCreated, markCopilotIssueOfferFailed,
  type NewCopilotIssueOffer,
} from './repos/copilot-issue-offers.js';
export type { CopilotIssueOffer } from './store/types.js';
export {
  renderCopilotOfferMessage, COPILOT_BLOCK_IDS, COPILOT_ACTION_IDS, type SlackPostMode,
} from './integrations/copilot-offer.js';
export {
  createReportOffer, getReportOffer, getUnpostedOfferForConversation as getUnpostedReportOfferForConversation, setReportOfferMessageTs,
  getLatestOfferForConversation as getLatestReportOfferForConversation,
  claimReportOffer, declineReportOffer, markReportOfferGenerated, markReportOfferFailed,
  type NewReportOffer,
} from './repos/report-offers.js';
export type { ReportOffer } from './store/types.js';
export {
  credsForConnection as credsForAwsConnection,
  resolveAwsCreds, accountFromRoleArn,
  type AwsCreds, type ResolvedAwsCreds, type AwsAuthConfig, type AwsAuthDeps,
} from './aws/auth.js';
export { realAwsClient, makeAwsClientForTest, resolveWindow as resolveAwsWindow, type AwsClient, type AwsWindow, type MetricQuery } from './aws/client.js';
export { probeSignals as probeAwsSignals, SIGNAL_TOOLS as AWS_SIGNAL_TOOLS, type AwsSignal, type AwsSignalReport } from './aws/probe.js';
export { validateAwsScope, scopeKey as awsScopeKey, latencyStatistics, logErrorQuery, type AwsAllowed } from './aws/recipes.js';
export { parseActivity, stripMention, type ParsedActivity } from './teams/activity.js';
export { authenticateActivity } from './teams/auth.js';
export { connectCardAttachment, teamsReplyText } from './teams/cards.js';
export {
  createConversationReport, listReportsForConversation, getConversationReport, getLatestReport,
  type NewConversationReport,
} from './repos/conversation-reports.js';
export type { ConversationReport } from './store/types.js';
