export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(path, {
    ...init,
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (res.status === 401) {
    // Session is missing/expired — bounce to login. Return a never-settling
    // promise so callers stay in their loading state during the full-page
    // navigation instead of flashing a raw "unauthenticated" error in the UI.
    if (typeof window !== 'undefined') {
      window.location.href = '/signin';
      return new Promise<T>(() => {});
    }
    throw new ApiError(401, 'unauthenticated'); // non-browser (SSR/tests): still throw
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Org = { id: string; name: string; slug: string };
export type Assistant = {
  id: string; name: string; persona: string; model: string; provider: string | null;
  enabledTools: string[];
  isLead: boolean;
  sourceProposalId: string | null;
  userModified: boolean;
};

export type OrgInfo = { slug: string; name: string; myOrgRole: 'owner' | 'manager' | 'user'; kgEnabled: boolean; hindsightEnabled: boolean; showCostUsd: boolean; reportsEnabled: boolean; debugEnabled: boolean };

export const updateOrgSettings = (body: { hindsightEnabled?: boolean; showCostUsd?: boolean; reportsEnabled?: boolean }) =>
  api<{ ok: true }>('/api/org/settings', { method: 'PATCH', body: JSON.stringify(body) });

/** Debug: fetch the fully-assembled system prompt for a saved (assistantId) or
 *  proposed ({persona, enabledTools, isLead}) assistant. Org debug flag gated. */
export type PromptPreviewBody =
  | { assistantId: string }
  | { persona: string; enabledTools: string[]; isLead?: boolean };
export const fetchPromptPreview = (slug: string, body: PromptPreviewBody) =>
  api<{ prompt: string }>(`/api/org/projects/${slug}/assistants/preview-prompt`, { method: 'POST', body: JSON.stringify(body) });

export type TierForecast = { inputTokens: number; outputTokens: number; costUsd: number };
export type TeamForecast = { basic: TierForecast; medium: TierForecast; large: TierForecast };
export const fetchTeamForecast = (slug: string) =>
  api<{ forecast: TeamForecast; showCostUsd: boolean }>(`/api/org/projects/${slug}/team/forecast`);
export type Me = { sub: string; email?: string; name?: string };
export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
export type ModelKey = {
  provider: string;
  keyHint: string;
  enabled: boolean;
  baseUrl: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
};
export type GithubMode = 'agent_app' | 'pat' | 'custom_app';
export type GithubEvents = { issues: boolean; pullRequests: boolean; branches: boolean };
export type GithubConnection = {
  provider: 'github';
  mode: GithubMode;
  baseUrl: string | null;
  accountLabel: string | null;
  secretHint: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  metadata: { installationId?: string; appId?: string; events?: GithubEvents; issuesEnabled?: boolean };
};
export type GitlabMode = 'access_token';
export type GitlabEvents = { push: boolean; issues: boolean; mergeRequests: boolean };
export type GitlabConnection = {
  provider: 'gitlab';
  mode: GitlabMode;
  baseUrl: string | null;
  accountLabel: string | null;
  secretHint: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  metadata: { gitlabEvents?: GitlabEvents; issuesEnabled?: boolean };
};
export type Project = { id: string; orgId: string; name: string; slug: string; description: string; reportsEnabled: boolean; createdAt: string; updatedAt: string };
export type ProjectCounts = { repos: number; assistants: number; members: number };
export type ProjectDetail = Project & { myProjectRole: 'admin' | 'user'; counts: ProjectCounts };
export type ProjectRepo = {
  id: string; projectId: string; orgIntegrationId: string;
  repoFullName: string; defaultBranch: string | null; addedByUserId: string; createdAt: string;
};
export type GcpMode = 'sa_key' | 'wif';
export type GcpSignal = 'monitoring' | 'logging' | 'trace' | 'errors';
export type GcpConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: GcpMode; enabled: boolean;
  metadata: { saEmail?: string; defaultGcpProjectId?: string; availableSignals?: GcpSignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null; createdAt: string;
};
export type GcpSignalReport = Record<GcpSignal, { ok: boolean; error?: string }>;
export type GcpTarget = {
  id: string; projectId: string; connectionId: string;
  gcpProjectId: string; label: string | null;
  metadata: { availableSignals?: GcpSignal[] }; addedByUserId: string; createdAt: string;
};
export type CloudflareMode = 'api_token' | 'global_key';
export type CloudflareSignal = 'analytics' | 'logs' | 'workers';
export type CloudflareConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: CloudflareMode; enabled: boolean;
  metadata: { accountId?: string; availableSignals?: CloudflareSignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null; createdAt: string;
};
export type CloudflareTarget = {
  id: string; projectId: string; connectionId: string;
  kind: 'account' | 'zone'; accountId: string; zoneId: string | null;
  name: string; label: string | null; workerScripts: string[] | null;
  metadata: { availableSignals?: CloudflareSignal[] }; addedByUserId: string; createdAt: string;
};
export type CloudflareSignalReport = Record<CloudflareSignal, { ok: boolean; error?: string }>;
export type CloudflareDiscoveredAccount = { id: string; name: string };
export type CloudflareDiscoveredZone = { id: string; name: string };
export type SentryConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: 'auth_token'; baseUrl: string; enabled: boolean;
  metadata: { sentryOrgSlug?: string; sentryOrgName?: string };
  secretHint: string | null;
  lastTestedAt: string | null; lastTestOk: boolean | null; createdAt: string;
};
export type SentryTarget = {
  id: string; projectId: string; connectionId: string;
  sentryProjectSlug: string; sentryProjectId: string;
  name: string; label: string | null; addedByUserId: string; createdAt: string;
};
export type SentryDiscoveredProject = { id: string; slug: string; name: string };
export type GrafanaSignal = 'metrics' | 'logs' | 'traces';
export type GrafanaDiscoveredDatasource = { uid: string; name: string; type: string };
export type GrafanaConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: 'grafana'; baseUrl: string; enabled: boolean;
  metadata: { grafanaOrgName?: string; availableSignals?: GrafanaSignal[]; datasources?: GrafanaDiscoveredDatasource[] };
  secretHint: string | null;
  lastTestedAt: string | null; lastTestOk: boolean | null; createdAt: string;
};
export type GrafanaTarget = {
  id: string; projectId: string; connectionId: string;
  datasourceUid: string; datasourceType: string;
  name: string; label: string | null; addedByUserId: string; createdAt: string;
};
export type GrafanaSignalReport = Record<GrafanaSignal, { ok: boolean; error?: string }>;
export type AzureMode = 'service_principal' | 'workload_identity';
export type AzureSignal = 'metrics' | 'logs' | 'traces' | 'alerts';
export type AzureConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: AzureMode; enabled: boolean;
  tenantId: string; clientId: string;
  secretHint: string | null; federationSubject: string | null;
  defaultSubscriptionId: string; defaultWorkspaceId: string | null;
  metadata: { availableSignals?: AzureSignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null;
};
export type AzureSignalReport = Record<AzureSignal, { ok: boolean; error?: string }>;
export type AzureTarget = {
  id: string; projectId: string; connectionId: string;
  subscriptionId: string; logAnalyticsWorkspaceId: string | null;
  region: string | null; label: string | null;
  addedByUserId: string; createdAt: string;
};
export type DatadogSite = 'us1' | 'us3' | 'us5' | 'eu' | 'ap1' | 'us1-fed';
export type DatadogSignal = 'metrics' | 'logs' | 'traces' | 'alerts';
export type DatadogConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  site: DatadogSite; enabled: boolean; secretHint: string | null;
  metadata: { availableSignals?: DatadogSignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null;
};
export type DatadogSignalReport = Record<DatadogSignal, { ok: boolean; error?: string }>;
export type DatadogTarget = {
  id: string; projectId: string; connectionId: string;
  env: string; service: string | null; label: string | null;
  addedByUserId: string; createdAt: string;
};
export type DynatraceSignal = 'metrics' | 'logs' | 'problems';
export type DynatraceConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  environmentUrl: string; enabled: boolean; secretHint: string | null;
  metadata: { availableSignals?: DynatraceSignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null;
};
export type DynatraceSignalReport = Record<DynatraceSignal, { ok: boolean; error?: string }>;
export type DynatraceTarget = {
  id: string; projectId: string; connectionId: string;
  managementZone: string | null; service: string | null; label: string | null;
  addedByUserId: string; createdAt: string;
};
export type PagerDutyRegion = 'us' | 'eu';
export type PagerDutySignal = 'alerts';
export type PagerDutyConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: string; region: PagerDutyRegion; enabled: boolean; secretHint: string | null;
  metadata: { availableSignals?: PagerDutySignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null;
};
export type PagerDutySignalReport = Record<PagerDutySignal, { ok: boolean; error?: string }>;
export type PagerDutyTarget = {
  id: string; projectId: string; connectionId: string;
  teamId: string | null; teamName: string | null;
  serviceId: string | null; serviceName: string | null;
  label: string | null;
  addedByUserId: string; createdAt: string;
};
export type AwsMode = 'access_key' | 'assume_role';
export type AwsSignal = 'metrics' | 'logs' | 'traces' | 'alarms';
export type AwsConnection = {
  id: string; orgId: string; projectId: string | null; name: string;
  mode: AwsMode; enabled: boolean;
  awsAccountId: string | null; defaultRegion: string;
  roleArn: string | null; externalId: string | null; secretHint: string | null;
  metadata: { availableSignals?: AwsSignal[] };
  lastTestedAt: string | null; lastTestOk: boolean | null; createdAt: string;
};
export type AwsSignalReport = Record<AwsSignal, { ok: boolean; error?: string }>;
export type AwsTarget = {
  id: string; projectId: string; connectionId: string;
  awsAccountId: string; awsRegion: string; label: string | null;
  addedByUserId: string; createdAt: string;
};
export type CatalogRepo = { id: string; orgIntegrationId: string; repoFullName: string; defaultBranch: string | null; private: boolean; syncedAt: string };
export type CatalogSync = { status: 'idle' | 'syncing' | 'error'; repoCount: number; finishedAt: string | null; error: string | null; stale: boolean };
export type CatalogResponse = { repos: CatalogRepo[]; nextCursor: string | null; total: number; sync: CatalogSync };
export type ProjectMember = { projectId: string; userId: string; role: 'admin' | 'user'; email: string | null };
export type OrgMember = { orgId: string; userId: string; role: 'owner' | 'manager' | 'user'; email: string | null };
export type OrgInvitation = {
  id: string; orgId: string; email: string; role: 'manager' | 'user';
  invitedBy: string; status: 'pending'; createdAt: string; expiresAt: string;
};
export type SlackChannelBinding = {
  id: string; slackChannelId: string; channelName: string | null;
  projectId: string | null; status: 'pending' | 'bound';
};
export type ProjectSlackChannels = { connected: boolean; assigned: SlackChannelBinding[]; available: SlackChannelBinding[] };
export type SlackConnectContext = {
  connected: boolean;
  orgName: string;
  orgSlug: string;
  channelId: string;
  currentBinding: { status: 'pending' | 'bound'; projectId: string | null } | null;
  projects: { id: string; name: string; slug: string }[];
};

export type TeamsConnection = {
  provider: 'teams';
  mode: 'central';
  accountLabel: string | null;
  enabled: boolean;
  lastTestOk: boolean | null;
  metadata?: { tenantId?: string; tenantName?: string };
};
export type TeamsChannelBinding = {
  id: string; teamsConversationId: string; channelName: string | null;
  projectId: string | null; status: 'pending' | 'bound';
};
export type ProjectTeamsChannels = { connected: boolean; assigned: TeamsChannelBinding[]; available: TeamsChannelBinding[] };
export type TeamsConnectContext = {
  connected: boolean;
  orgName: string;
  orgSlug: string;
  conversationId: string;
  projects: { id: string; name: string; slug: string }[];
};

export type ParticipantRole = 'human' | 'assistant' | 'sub-agent' | 'system';

export type Participant = {
  key: string;
  name: string;
  role: ParticipantRole;
  color: string;
};

export type ThreadEvent =
  | { kind: 'message'; id: string; at: string; participantKey: string; conversationId: string; text: string }
  | {
      kind: 'tool'; id: string; at: string; participantKey: string; conversationId: string;
      name: string; status: string; latencyMs: number | null;
      input: string | null; output: string | null; truncated: boolean; error: string | null;
    }
  | { kind: 'handover'; id: string; at: string; fromKey: string; toKey: string; toName: string; task: string | null }
  | { kind: 'return'; id: string; at: string; fromKey: string; toKey: string };

export type ConversationThread = {
  conversationId: string;
  source: string;
  status: string;
  title: string;
  participants: Participant[];
  events: ThreadEvent[];
  totals: { inputTokens: number; outputTokens: number; costUsd: string | null };
};

export type ConversationSummary = {
  id: string;
  source: string;
  status: string;
  title: string;
  preview: string | null;
  assistantIds: string[];
  agentCount: number;
  createdAt: string;
  lastActivityAt: string;
};

export type GroupProvider = 'platform' | 'anthropic' | 'openai' | 'google' | 'openai-compatible';
export type PickerModel = {
  id: string; displayName: string; origin: 'curated' | 'live';
  capabilities: { tools: boolean; streaming: boolean }; alsoOn?: GroupProvider[];
  pricing?: { inputPer1M: number; outputPer1M: number };
};
export type ModelGroup = {
  provider: GroupProvider; label: string; source: 'platform' | 'byok';
  models: PickerModel[]; freeEntry?: boolean; custom?: { baseUrl: string };
};
export type McpTool = { name: string; kind: 'mcp'; mutates: boolean; description: string };
export type IntegrationTool = { name: string; mutates: boolean; description: string };

export const fetchModelGroups = (slug: string) =>
  api<{ groups: ModelGroup[] }>(`/api/org/projects/${slug}/models`).then((r) => r.groups);
export const refreshModels = (slug: string, provider: GroupProvider) =>
  api<{ groups: ModelGroup[] }>(`/api/org/projects/${slug}/models/refresh`, { method: 'POST', body: JSON.stringify({ provider }) }).then((r) => r.groups);
export const fetchMcpTools = (slug: string) =>
  api<{ tools: McpTool[] }>(`/api/org/projects/${slug}/mcp-tools`).then((r) => r.tools);
export const fetchIntegrationTools = (slug: string) =>
  api<{ tools: IntegrationTool[] }>(`/api/org/projects/${slug}/integration-tools`).then((r) => r.tools);

export type SystemAgentMeta = { key: string; name: string };
/** Predefined system agents (Slack Intake, Hindsight) — used to label `agent.sys.<key>` nodes. */
export const fetchSystemAgents = (slug: string) =>
  api<SystemAgentMeta[]>(`/api/org/projects/${slug}/system-agents`);

export type ApprovalPolicy = { writeToolsRequireApproval: boolean; overrides?: Record<string, boolean> };
/** Project write-operations policy. `orgManaged` = the org set its own policy, which overrides the project's. */
export const fetchApprovalPolicy = (slug: string) =>
  api<{ policy: ApprovalPolicy | null; orgManaged: boolean }>(`/api/org/projects/${slug}/approval-policy`);
export const saveApprovalPolicy = (slug: string, policy: ApprovalPolicy | null) =>
  api<void>(`/api/org/projects/${slug}/approval-policy`, { method: 'PUT', body: JSON.stringify({ policy }) });

export type KgBuildStatus = {
  status: 'running' | 'done' | 'error';
  phase: string | null;
  nodesAnalyzed: number;
  tokens: number;
  note: string | null;
  finishedAt: string | null;
};
export type KgFlow = { id: string; name: string; digest: string | null };
export type KgGraphNode = {
  id: string;
  kind: string;
  name: string;
  businessFlow: string | null;
  digest: string | null;
  metadata: Record<string, unknown> | null;
  repoFullName: string | null;
};
export type KgGraphEdge = { src: string; dst: string; relation: string };
export type KgGraph = { nodes: KgGraphNode[]; edges: KgGraphEdge[] };

export const fetchKnowledgeGraph = (slug: string) =>
  api<{ build: KgBuildStatus | null; flows: KgFlow[] }>(`/api/org/projects/${slug}/knowledge-graph`);
export const triggerKgBuild = (slug: string) =>
  api<{ accepted: boolean; buildId: string }>(`/api/org/projects/${slug}/knowledge-graph/build`, {
    method: 'POST',
  });
export const fetchKgGraph = (slug: string) =>
  api<KgGraph>(`/api/org/projects/${slug}/knowledge-graph/graph`);
export const fetchKgChildren = (slug: string, nodeId: string, rels: string[], dir: 'in' | 'out' = 'out') =>
  api<{ children: KgGraphNode[] }>(
    `/api/org/projects/${slug}/knowledge-graph/children?node=${encodeURIComponent(nodeId)}&rel=${encodeURIComponent(rels.join(','))}&dir=${dir}`,
  ).then((r) => r.children);

export type TeamGap = {
  kind: 'integration' | 'data';
  title: string;
  detail: string;
  severity: 'critical' | 'recommended' | 'optional';
  audience: 'raise' | 'record';
  integration: 'slack' | 'gcp' | 'cloudflare' | 'github' | null;
};
export type ProposedAssistant = { key: string; name: string; persona: string; model: string; provider: string | null; isLead: boolean; enabledTools: string[]; delegatesTo: string[]; rationale: string };
export type TeamProposalDoc = { rationale: string; assistants: ProposedAssistant[]; gaps: TeamGap[] };
export type TeamProposalFacts = {
  components: { name: string; summary: string; live: boolean }[];
  codeComplexity: string;
  signalMap: { product: string; integration: string }[];
  gaps: TeamGap[];
};
export type TeamProposal = {
  id: string; status: 'generating' | 'ready' | 'applied' | 'discarded' | 'failed';
  buildId: string | null; proposal: TeamProposalDoc | null; error: string | null;
  facts: TeamProposalFacts | null;
  /** Current pipeline phase while generating (a TeamAutogenPhase key), or null. */
  progress: string | null;
};

const teamBase = (slug: string) => `/api/org/projects/${slug}/team`;
export const fetchTeamProposal = (slug: string) => api<TeamProposal | null>(`${teamBase(slug)}/proposal`);
/** Most recent non-discarded proposal (incl. applied) — powers the generation-results page. */
export const fetchLatestProposal = (slug: string) => api<TeamProposal | null>(`${teamBase(slug)}/proposal/latest`);
export const generateTeam = (slug: string) => api<TeamProposal>(`${teamBase(slug)}/generate`, { method: 'POST' });
export const applyTeamProposal = (slug: string, id: string) => api<Assistant[]>(`${teamBase(slug)}/proposals/${id}/apply`, { method: 'POST' });
export const discardTeamProposal = (slug: string, id: string) => api<void>(`${teamBase(slug)}/proposals/${id}/discard`, { method: 'POST' });

export type TeamVersion = {
  id: string; version: number | null; createdAt: string; status: 'ready' | 'applied';
  isActive: boolean; agentCount: number; rationale: string;
};
export const fetchTeamVersions = (slug: string) =>
  api<{ versions: TeamVersion[]; total: number }>(`${teamBase(slug)}/versions`);
/** "Apply" doubles as "activate this version". */
export const activateTeamVersion = (slug: string, id: string) =>
  api<Assistant[]>(`${teamBase(slug)}/proposals/${id}/apply`, { method: 'POST' });

export type AgentMemory = { id: string; scope: 'private' | 'team'; content: string; usageCount: number; lastRecalledAt: string | null; createdAt: string };
const memBase = (slug: string) => `/api/org/projects/${slug}/memories`;
export const fetchMemories = (slug: string) => api<AgentMemory[]>(memBase(slug));
export const addMemory = (slug: string, content: string) => api<AgentMemory>(memBase(slug), { method: 'POST', body: JSON.stringify({ content }) });
export const deleteMemory = (slug: string, id: string) => api<void>(`${memBase(slug)}/${id}`, { method: 'DELETE' });

const asstMemBase = (slug: string, aid: string) => `/api/org/projects/${slug}/assistants/${aid}/memories`;
export const fetchAssistantMemories = (slug: string, aid: string) => api<AgentMemory[]>(asstMemBase(slug, aid));
export const addAssistantMemory = (slug: string, aid: string, content: string) =>
  api<AgentMemory>(asstMemBase(slug, aid), { method: 'POST', body: JSON.stringify({ content }) });
export const deleteAssistantMemory = (slug: string, aid: string, id: string) =>
  api<void>(`${asstMemBase(slug, aid)}/${id}`, { method: 'DELETE' });

export type AgentSkill = { id: string; name: string; description: string; body: string; createdAt: string; updatedAt: string };
export type AttachedSkill = { id: string; name: string; description: string };

const skillsBase = (slug: string) => `/api/org/projects/${slug}/skills`;
export const fetchSkills = (slug: string) => api<AgentSkill[]>(skillsBase(slug));
export const createSkill = (slug: string, b: { name: string; description: string; body: string }) =>
  api<AgentSkill>(skillsBase(slug), { method: 'POST', body: JSON.stringify(b) });
export const updateSkill = (slug: string, id: string, b: Partial<{ name: string; description: string; body: string }>) =>
  api<AgentSkill>(`${skillsBase(slug)}/${id}`, { method: 'PATCH', body: JSON.stringify(b) });
export const deleteSkill = (slug: string, id: string) =>
  api<void>(`${skillsBase(slug)}/${id}`, { method: 'DELETE' });

const asstSkillsBase = (slug: string, aid: string) => `/api/org/projects/${slug}/assistants/${aid}/skills`;
export const fetchAttachedSkills = (slug: string, aid: string) => api<AttachedSkill[]>(asstSkillsBase(slug, aid));
export const setAttachedSkills = (slug: string, aid: string, skillIds: string[]) =>
  api<void>(asstSkillsBase(slug, aid), { method: 'PUT', body: JSON.stringify({ skillIds }) });

export const setGithubIssuesEnabled = (enabled: boolean) =>
  api<{ ok: true }>('/api/github/connection/issues', { method: 'PATCH', body: JSON.stringify({ enabled }) });

export const getGitlabConnection = () =>
  api<GitlabConnection | null>('/api/gitlab/connection');
export const saveGitlabToken = (body: { token: string; baseUrl?: string }) =>
  api<GitlabConnection>('/api/gitlab/connection/token', { method: 'PUT', body: JSON.stringify(body) });
export const testGitlabConnection = () =>
  api<{ ok: boolean; detail?: string; repoCount?: number | null }>('/api/gitlab/connection/test', { method: 'POST' });
export const getGitlabWebhook = () =>
  api<{ url: string; secret: string | null }>('/api/gitlab/connection/webhook');
export const setGitlabEvents = (partial: Partial<GitlabEvents>) =>
  api<GitlabConnection>('/api/gitlab/connection/events', { method: 'PATCH', body: JSON.stringify(partial) });
export const setGitlabIssuesEnabled = (enabled: boolean) =>
  api<{ ok: true }>('/api/gitlab/connection/issues', { method: 'PATCH', body: JSON.stringify({ enabled }) });
export const deleteGitlabConnection = () =>
  api<void>('/api/gitlab/connection', { method: 'DELETE' });

export const getProjectSettings = (slug: string) =>
  api<{ issuesEnabled: boolean; issuesOrgEnabled: boolean; issuesOrgEnabledGitlab: boolean }>(`/api/org/projects/${slug}/settings`);
export const setProjectIssuesEnabled = (slug: string, issuesEnabled: boolean) =>
  api<{ ok: true }>(`/api/org/projects/${slug}/settings`, { method: 'PATCH', body: JSON.stringify({ issuesEnabled }) });
export const setProjectReportsEnabled = (slug: string, reportsEnabled: boolean) =>
  api<{ ok: true }>(`/api/org/projects/${slug}/settings`, { method: 'PATCH', body: JSON.stringify({ reportsEnabled }) });

export type ConversationReport = { id: string; version: number; createdAt: string };
export const fetchConversationReports = (slug: string, cid: string) =>
  api<ConversationReport[]>(`/api/org/projects/${slug}/conversations/${cid}/reports`);

export type ReportOfferStatus = 'offered' | 'generating' | 'generated' | 'declined' | 'failed';
export type ReportOffer = {
  id: string;
  status: ReportOfferStatus;
  reportId: string | null;
  reportUrl: string | null;
  error: string | null;
};
export const fetchLatestReportOffer = (slug: string, cid: string) =>
  api<ReportOffer | null>(`/api/org/projects/${slug}/conversations/${cid}/report-offer`);

export type OrgBillingInfo = {
  billingEnabled: boolean;
  band: 'indie' | 'startup' | 'scaleup' | 'enterprise';
  bandLabel: string;
  priceUsd: number | null;
  custom: boolean;
  usage: { period: string; billableCostUsd: number; invocationCount: number };
  spendCapUsd: number | null;
  subscriptionStatus: string | null;
  stripeReady: boolean;
  creditBalanceCents: number;
};
export const fetchBilling = () => api<OrgBillingInfo>('/api/org/billing');
export const startCheckout = (band: 'startup' | 'scaleup') =>
  api<{ subscriptionStatus: string }>('/api/org/billing/checkout', { method: 'POST', body: JSON.stringify({ band }) });
export const openBillingPortal = () =>
  api<{ url: string }>('/api/org/billing/portal', { method: 'POST' });
export const startCreditCheckout = (amountCents: number) =>
  api<{ url: string }>('/api/org/credits/checkout', { method: 'POST', body: JSON.stringify({ amountCents }) });

export type CreditLedgerRow = {
  id: string; kind: string; amountCents: number; balanceAfterCents: number | null;
  note?: string | null; createdAt: string;
};
export const fetchCreditLedger = () => api<{ entries: CreditLedgerRow[] }>('/api/org/credits/ledger');

export const getTeamsConnection = () =>
  api<TeamsConnection | null>('/api/teams/connection');
export const disconnectTeams = () =>
  api<void>('/api/teams/connection', { method: 'DELETE' });
export const testTeams = () =>
  api<{ ok: boolean; detail?: string }>('/api/teams/connection/test', { method: 'POST' });
export const listTeamsChannels = () =>
  api<TeamsChannelBinding[]>('/api/teams/channels');
export const getProjectTeamsChannels = (slug: string) =>
  api<ProjectTeamsChannels>(`/api/org/projects/${slug}/teams-channels`);
export const addProjectTeamsChannel = (slug: string, conversationId: string) =>
  api<TeamsChannelBinding>(`/api/org/projects/${slug}/teams-channels`, { method: 'POST', body: JSON.stringify({ conversationId }) });
export const removeProjectTeamsChannel = (slug: string, conversationId: string) =>
  api<void>(`/api/org/projects/${slug}/teams-channels/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
