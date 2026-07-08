import { listProjectRepos, resolveRepoRef, listSlackBindingsByProject, listGcpTargets, getGcpProjectConnection, getGcpConnection, listCloudflareTargets, getProjectConnection, getConnection, getSentryProjectConnection, getSentryConnection, listSentryTargets, getGrafanaProjectConnection, getGrafanaConnection, listGrafanaTargets, RCA_OPERATING_PREAMBLE, listAttachedSkills, renderSkillsBlock, withSkillTool, listAwsTargets, listAwsConnectionsForProject, listAzureTargets, listAzureConnectionsForProject, listDatadogTargets, listDatadogConnectionsForProject, listDynatraceTargets, listDynatraceConnectionsForProject, listPagerDutyTargets, listPagerDutyConnectionsForProject, getProjectOrgId, type Db, type GcpSignal, type GcpConnectionMetadata, type GrafanaSignal, type AwsSignal, type AzureSignal, type DatadogSignal, type DynatraceSignal, type PagerDutySignal } from '@intellilabs/core';
export { renderSkillsBlock, withSkillTool };
import { toolGuidanceBlocks } from '@intellilabs/engine';
import { SIGNAL_OF as GCP_TOOL_SIGNAL } from './gcp/tools.js';
import { SIGNAL_OF as GRAFANA_TOOL_SIGNAL } from './grafana/tools.js';
import { SIGNAL_OF as AWS_TOOL_SIGNAL } from './aws/tools.js';
import { SIGNAL_OF as AZURE_TOOL_SIGNAL } from './azure/tools.js';
import { SIGNAL_OF as DATADOG_TOOL_SIGNAL } from './datadog/tools.js';
import { SIGNAL_OF as DYNATRACE_TOOL_SIGNAL } from './dynatrace/tools.js';
import { SIGNAL_OF as PAGERDUTY_TOOL_SIGNAL } from './pagerduty/tools.js';

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };
export type RepoRefView = { repo: string; ref: string | null };
export type ChannelView = { name: string | null; id: string };

// Human-readable capability per tool (for the "You can:" summary line).
const OP_LABEL: Record<string, string> = {
  'integration.github.list_repos': 'list repositories',
  'integration.github.get_file': 'read files',
  'integration.github.list_directory': 'list directories',
  'integration.github.search_code': 'search code',
  'integration.github.get_ref_info': 'resolve the exact commit SHA',
  'integration.github.search_issues': 'search issues',
  'integration.github.get_issue': 'read issues',
  'integration.github.create_issue': 'open issues',
  'integration.github.list_pull_requests': 'list pull requests',
  'integration.github.get_pull_request': 'read pull requests',
};

// Extra guidance bullets, only emitted when that specific tool is enabled.
const OP_GUIDANCE: Record<string, string> = {
  'integration.github.get_ref_info':
    'Before quoting code as authoritative, call `integration.github.get_ref_info` to learn the exact commit SHA and cite it.',
  'integration.github.search_code':
    '`integration.github.search_code` indexes the repository default branch, so results may not match a pinned commit — confirm hits with `integration.github.get_file`.',
  'integration.github.list_repos':
    'Use `integration.github.list_repos` to see which repositories you can access.',
  'integration.github.create_issue':
    '`integration.github.create_issue` makes a real change and may require user approval.',
};

const CODE_READ_TOOLS = [
  'integration.github.get_file',
  'integration.github.list_directory',
  'integration.github.search_code',
  'integration.github.get_ref_info',
];

/** Compose a GitHub skill block from the enabled github tools + live repo context.
 *  Returns '' when no github tools are enabled. */
export function renderGithubSkill(enabledGithubTools: string[], repos: RepoRefView[]): string {
  const enabled = enabledGithubTools.filter((t) => t in OP_LABEL);
  if (enabled.length === 0) return '';

  const ops = enabled.map((t) => OP_LABEL[t]).join(', ');
  const hasGithub = (t: string) => enabled.includes(`integration.github.${t}`);
  const parts: string[] = [`## GitHub tools — the PRIMARY source of truth\n\nThe code is authoritative: when you need to know what the system actually does, read it here rather than guessing. You can ${ops} from this project's repositories.`];

  const bullets: string[] = [];
  // Ref-hiding note only matters when a code-reading tool is enabled.
  if (enabled.some((t) => CODE_READ_TOOLS.includes(t))) {
    bullets.push(
      "You do **not** choose a branch or commit — the system reads each repo at the project's pinned code version automatically. Just pass `repo` and `path`/`query`.",
    );
  }
  // How/when workflow: locate → read → trace → cite.
  if (hasGithub('search_code')) bullets.push('To localize a symptom, start with `integration.github.search_code` (a symbol, error string, route, or config key) to find the relevant files.');
  if (hasGithub('get_file')) bullets.push('Read the implementation with `integration.github.get_file`, then trace its call sites and dependencies by searching for the names it uses.');
  if (hasGithub('list_directory')) bullets.push('Use `integration.github.list_directory` to orient yourself in an unfamiliar area before reading individual files.');
  bullets.push('Always cite evidence as `file:line` (e.g. `apps/server/src/foo.ts:42`) so your conclusions are checkable. Do not assert how code behaves without having read it.');
  for (const t of enabled) if (OP_GUIDANCE[t]) bullets.push(OP_GUIDANCE[t]);
  if (bullets.length) parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  if (repos.length) {
    const lines = repos.map((r) => `- ${r.repo} @ ${r.ref ?? '(repo default)'}`).join('\n');
    parts.push(`**Repositories in scope:**\n${lines}`);
  }
  return parts.join('\n\n') + '\n';
}

const SLACK_OP_LABEL: Record<string, string> = {
  'integration.slack.post_message': 'post messages',
  'integration.slack.reply_in_thread': 'reply in threads',
};

/** Compose a Slack skill block from the enabled slack tools + the project's bound
 *  channels. Returns '' when no slack tools are enabled. */
export function renderSlackSkill(enabledSlackTools: string[], channels: ChannelView[]): string {
  const enabled = enabledSlackTools.filter((t) => t in SLACK_OP_LABEL);
  if (enabled.length === 0) return '';

  const ops = enabled.map((t) => SLACK_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Slack tools\n\nYou can ${ops} in this project's channels.`];

  const bullets: string[] = [
    'Messages are visible to real people — post only when it adds value, and may require user approval.',
    'Use only the channel ids listed below; you cannot post to other channels.',
  ];
  if (enabled.includes('integration.slack.reply_in_thread')) {
    bullets.push('`integration.slack.reply_in_thread` replies in the Slack thread that triggered this conversation — just provide the text (available only when this conversation came from Slack).');
  }
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  if (channels.length) {
    const lines = channels.map((c) => `- ${c.name ? `#${c.name} ` : ''}(${c.id})`).join('\n');
    parts.push(`**Channels in scope:**\n${lines}`);
  }
  return parts.join('\n\n') + '\n';
}

const KG_OP_LABEL: Record<string, string> = {
  'integration.knowledge-graph.list_flows': 'list business flows',
  'integration.knowledge-graph.walkthrough': 'see how a flow is implemented',
  'integration.knowledge-graph.blast_radius': "assess a change's impact",
  'integration.knowledge-graph.get_node': 'look up a file or flow',
};

/** Compose a Knowledge Graph skill block from the enabled KG tools + the project's repos.
 *  Returns '' when no KG tools are enabled. Bullets/recipe reference only enabled tools. */
export function renderKnowledgeGraphSkill(enabledKgTools: string[], repos: string[]): string {
  const enabled = enabledKgTools.filter((t) => t in KG_OP_LABEL);
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.knowledge-graph.${t}`);
  const ops = enabled.map((t) => KG_OP_LABEL[t]).join(', ');
  const parts: string[] = [
    `## Knowledge Graph tools\n\nThis project has a Code Knowledge Graph — a map of how its code implements business flows. You can ${ops}.`,
  ];
  const steps: string[] = [];
  if (has('list_flows')) steps.push('Start with `integration.knowledge-graph.list_flows` and pick the flow whose digest matches the question.');
  if (has('walkthrough')) steps.push("Call `integration.knowledge-graph.walkthrough` with a flow's id to see the files that implement it.");
  if (has('blast_radius')) steps.push('Call `integration.knowledge-graph.blast_radius` with a node id + direction (`downstream` = what it affects, `upstream` = what affects it) to gauge impact.');
  if (has('get_node')) steps.push('Call `integration.knowledge-graph.get_node` to look up any id you encounter.');
  steps.push('All ids come from earlier results — never invent them.');
  parts.push(steps.map((b) => `- ${b}`).join('\n'));
  if (repos.length) parts.push(`**Repositories with graphs:**\n${repos.map((r) => `- ${r}`).join('\n')}`);
  return parts.join('\n\n') + '\n';
}

export type GcpScopeView = {
  unrestricted: boolean;
  signals: GcpSignal[];
  projects: { gcpProjectId: string; label: string | null }[];
};

const GCP_OP_LABEL: Record<string, string> = {
  'integration.gcp.list_scope': 'see what you can query (bound connection + allowed GCP projects)',
  'integration.gcp.describe_datasets': 'look up metrics/logs/traces datasets and query syntax',
  'integration.gcp.query_metrics': 'query metrics with PromQL',
  'integration.gcp.query_logs': 'query logs with Cloud Logging filters',
  'integration.gcp.list_traces': 'list traces',
  'integration.gcp.get_trace': 'read a trace',
  'integration.gcp.list_metric_descriptors': 'discover metric names',
  'integration.gcp.error_rate_summary': 'summarize request error rates',
  'integration.gcp.latency_summary': 'summarize request latency percentiles',
  'integration.gcp.log_error_summary': 'summarize severity>=ERROR log entries',
  'integration.gcp.list_error_groups': 'list the top Error Reporting groups',
  'integration.gcp.get_error_group': 'read one Error Reporting group (stats + events with stack traces)',
};

// Which connection signal each gcp tool requires; list_scope/describe_datasets are
// signal-less → always shown when bound. SIGNAL_OF is imported from gcp/tools.ts so
// the skill block and the actual tool gating can't drift. SIGNAL_OF keys are bare
// tool names (no `integration.gcp.` prefix).
const gcpSignalFor = (fqName: string): GcpSignal | undefined =>
  GCP_TOOL_SIGNAL[fqName.replace('integration.gcp.', '')] as GcpSignal | undefined;

/** Compose a GCP observability skill block from the enabled gcp tools + the project's
 *  scope. Only signals granted by the bound connection are described; recipe + raw
 *  tools are gated by their connection signal, while list_scope/describe_datasets are
 *  always shown. Returns '' when no gcp tools are enabled. */
export function renderGcpSkill(enabledGcpTools: string[], scope: GcpScopeView): string {
  const granted = new Set<GcpSignal>(scope.signals);
  // Drop tools whose required signal isn't granted (signal-less tools → always kept).
  const enabled = enabledGcpTools.filter((t) => {
    if (!(t in GCP_OP_LABEL)) return false;
    const sig = gcpSignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.gcp.${t}`);
  const ops = enabled.map((t) => GCP_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## GCP observability tools\n\nThis project can query Google Cloud observability data (read-only) — your second source of truth after the code, used to confirm a hypothesis in production. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **metrics** (error rate / latency) to see *what* changed and *when*, then read **logs** to find the failing requests and error messages, then pull **traces** to follow a single failing request end-to-end. Quote the query and its result for any claim.',
    'Call `integration.gcp.list_scope` first to learn the bound connection, its default project, and which GCP projects you may query.',
    'Pass `gcpProject` — the GCP project id to query. ' + (scope.unrestricted
      ? 'Scope is **unrestricted**: you may query any GCP project the connection\'s service account can access. `gcpProject` is required — use `list_scope` to find the connection\'s default project.'
      : 'You may only query the GCP projects listed below; `gcpProject` must be one of them (it defaults to the single project in scope when there is only one).'),
    'Bound time queries with `window` (e.g. `"15m"`, `"1h"`, `"7d"`) or explicit start/end.',
  ];
  if (['error_rate_summary', 'latency_summary', 'log_error_summary'].some((t) => has(t))) {
    bullets.push('Prefer the purpose-built RCA recipes (`error_rate_summary`, `latency_summary`, `log_error_summary` — each takes a `gcpProject` + a time window) — they return reliable, pre-shaped results.');
  }
  if (has('describe_datasets')) bullets.push('Call `describe_datasets` before writing a raw `query_metrics` PromQL or `query_logs` filter — it lists the available datasets, metrics, and query syntax.');
  if (has('query_metrics')) bullets.push('`query_metrics` takes PromQL. Omit `step` for an instant value; pass `step` (e.g. `"60s"`) for a range. Use `list_metric_descriptors` to find metric names.');
  if (has('query_logs')) bullets.push('`query_logs` takes the Cloud Logging filter language, e.g. `severity>=ERROR AND resource.type="cloud_run_revision"`.');
  if (has('list_traces')) bullets.push('`list_traces` accepts a Cloud Trace filter (e.g. `+root:/api/checkout`); follow up with `get_trace` for spans.');
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.unrestricted
    ? 'any GCP project the connection can access (unrestricted)'
    : (scope.projects.length
      ? scope.projects.map((p) => `${p.gcpProjectId}${p.label ? ` (${p.label})` : ''}`).join(', ')
      : '(no GCP projects configured)');
  parts.push(`**GCP projects in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type CloudflareScopeView = {
  account: string | null;
  unrestricted: boolean;
  resources: { kind: string; name: string }[];
};

const CF_OP_LABEL: Record<string, string> = {
  'integration.cloudflare.list_scope': 'see what you can query (account + allowed zones/accounts)',
  'integration.cloudflare.describe_datasets': 'look up GraphQL datasets',
  'integration.cloudflare.query_graphql': 'query analytics and sampled logs (GraphQL)',
  'integration.cloudflare.query_worker_logs': 'query Workers Observability logs',
  'integration.cloudflare.http_error_summary': 'summarize HTTP errors and top failing paths',
  'integration.cloudflare.latency_summary': 'summarize response-time percentiles',
  'integration.cloudflare.firewall_events': 'review WAF/firewall events',
  'integration.cloudflare.worker_errors': 'review Worker errors',
};

/** Compose a Cloudflare skill block from the enabled cloudflare tools + the project's scope.
 *  Returns '' when no cloudflare tools are enabled. */
export function renderCloudflareSkill(enabledTools: string[], scope: CloudflareScopeView): string {
  const enabled = enabledTools.filter((t) => t in CF_OP_LABEL);
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.cloudflare.${t}`);
  const ops = enabled.map((t) => CF_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Cloudflare observability tools\n\nThis project can query Cloudflare logs and metrics (read-only) — a source of truth for edge/HTTP behavior, used to confirm a hypothesis after the code. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with the **error/latency summaries** to see what is failing at the edge and which paths, then drop to **Worker logs** (`query_worker_logs`) or raw **GraphQL** (`query_graphql`) to dig into specific requests. Quote the query and its result for any claim.',
    'Call `integration.cloudflare.list_scope` first to learn which account and zones/accounts you may query.',
  ];
  if (['http_error_summary', 'latency_summary', 'firewall_events', 'worker_errors'].some((t) => has(t))) {
    bullets.push('Prefer the purpose-built RCA recipes (`http_error_summary`, `latency_summary`, `firewall_events` take a `zone`; `worker_errors` takes an optional `account`) — they return reliable, pre-shaped results.');
  }
  if (has('query_graphql')) bullets.push('`query_graphql` is the raw escape hatch for questions the recipes don\'t cover. You MUST scope it: `viewer.zones(filter:{zoneTag})` for zone data, `viewer.accounts(filter:{accountTag})` for account data — only the zones/accounts in scope are allowed (any if unrestricted); the scope is validated. Call `describe_datasets` first for dataset names, dimensions, and examples. Bound time with datetime_geq/datetime_leq.');
  if (has('query_worker_logs')) bullets.push('`query_worker_logs` takes an optional `account` (defaults to the connection account); bound the time range with `window` (e.g. `"15m"`) or start/end.');
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.unrestricted
    ? `any zone/account on account ${scope.account ?? '(unknown)'}`
    : (scope.resources.length
      ? scope.resources.map((r) => `${r.name} (${r.kind})`).join(', ')
      : '(no resources configured)');
  parts.push(`**Scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type SentryScopeView = {
  org: string | null;
  unrestricted: boolean;
  projects: { slug: string; name: string }[];
};

const SENTRY_OP_LABEL: Record<string, string> = {
  'integration.sentry.list_scope': 'see what you can query (org + allowed Sentry projects)',
  'integration.sentry.list_issues': 'list grouped issues (errors)',
  'integration.sentry.get_issue': 'read one issue (culprit, level, counts, first/last seen)',
  'integration.sentry.get_latest_event': "read an issue's latest event (stack trace, breadcrumbs, tags, contexts)",
};

/** Compose a Sentry skill block from the enabled sentry tools + the project's scope.
 *  Returns '' when no sentry tools are enabled. */
export function renderSentrySkill(enabledTools: string[], scope: SentryScopeView): string {
  const enabled = enabledTools.filter((t) => t in SENTRY_OP_LABEL);
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.sentry.${t}`);
  const ops = enabled.map((t) => SENTRY_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Sentry tools\n\nThis project can query Sentry error tracking (read-only) — a source of truth for application exceptions, used to find what is failing and link it back to the code. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **`list_issues`** (filter with a Sentry `query` like `is:unresolved`) to find the error groups, read one with **`get_issue`**, then call **`get_latest_event`** to get the stack trace, breadcrumbs, and tags for a concrete occurrence. Quote the issue and the failing frame for any claim.',
    'Call `integration.sentry.list_scope` first to learn the Sentry organization and which projects you may query.',
  ];
  if (has('get_latest_event')) {
    bullets.push("`get_latest_event` is the key RCA tool: the top in-app stack frame gives a `file:line` — read that code with the GitHub / Knowledge Graph tools to confirm the root cause.");
  }
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.unrestricted
    ? `any project in the ${scope.org ?? '(unknown)'} Sentry organization (unrestricted)`
    : (scope.projects.length
      ? scope.projects.map((p) => `${p.name} (${p.slug})`).join(', ')
      : '(no Sentry projects configured)');
  parts.push(`**Sentry projects in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type GrafanaScopeView = {
  unrestricted: boolean;
  signals: GrafanaSignal[];
  datasources: { uid: string; type: string; name: string }[];
};

const GRAFANA_OP_LABEL: Record<string, string> = {
  'integration.grafana.list_scope': 'see what you can query (bound connection + allowed datasources)',
  'integration.grafana.describe_datasets': 'look up PromQL/LogQL/TraceQL query syntax',
  'integration.grafana.query_metrics': 'query metrics with PromQL (Prometheus)',
  'integration.grafana.query_logs': 'query logs with LogQL (Loki)',
  'integration.grafana.list_traces': 'search traces with TraceQL (Tempo)',
  'integration.grafana.get_trace': 'read one trace by id (Tempo)',
  'integration.grafana.error_rate_summary': 'summarize request error rates',
  'integration.grafana.latency_summary': 'summarize request latency percentiles',
  'integration.grafana.log_error_summary': 'summarize recent error log lines',
};

const grafanaSignalFor = (fqName: string): GrafanaSignal | undefined =>
  GRAFANA_TOOL_SIGNAL[fqName.replace('integration.grafana.', '')] as GrafanaSignal | undefined;

/** Compose a Grafana skill block from the enabled tools + the project's scope.
 *  Returns '' when no usable tools are enabled. */
export function renderGrafanaSkill(enabledTools: string[], scope: GrafanaScopeView): string {
  const granted = new Set<GrafanaSignal>(scope.signals);
  const enabled = enabledTools.filter((t) => {
    if (!(t in GRAFANA_OP_LABEL)) return false;
    const sig = grafanaSignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.grafana.${t}`);
  const ops = enabled.map((t) => GRAFANA_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Grafana observability tools\n\nThis project can query Grafana (read-only) — metrics, logs, and traces from your Prometheus/Loki/Tempo datasources, used to confirm a hypothesis in production. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **metrics** (error rate / latency) to see *what* changed and *when*, then read **logs** for the failing requests and error messages, then pull **traces** to follow one failing request end-to-end. Quote the query and its result for any claim.',
    'Call `integration.grafana.list_scope` first to learn the datasources you may query and their uids.',
    'Pass `datasourceUid` to target a datasource. ' + (scope.unrestricted
      ? 'Scope is **unrestricted**: you may query any datasource the connection can reach. `datasourceUid` defaults to the only datasource of the needed type when there is just one.'
      : 'You may only query the datasources listed below; `datasourceUid` must be one of them (it defaults to the single datasource of the needed type when there is only one).'),
    'Bound time queries with `window` (e.g. `"15m"`, `"1h"`, `"7d"`) or explicit start/end.',
  ];
  if (has('describe_datasets')) bullets.push('Call `describe_datasets` before writing a raw query — it covers PromQL, LogQL, and TraceQL syntax.');
  if (['error_rate_summary', 'latency_summary', 'log_error_summary'].some((t) => has(t))) {
    bullets.push('The RCA recipes (`error_rate_summary`, `latency_summary`, `log_error_summary`) assume common metric/label names; if your stack differs, use the raw query tools.');
  }
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.unrestricted
    ? 'any datasource the connection can reach (unrestricted)'
    : (scope.datasources.length
      ? scope.datasources.map((d) => `${d.name} (${d.type})`).join(', ')
      : '(no datasources configured)');
  parts.push(`**Datasources in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type AwsScopeView = {
  signals: AwsSignal[];
  scope: { account: string; region: string; label: string | null }[];
};

const AWS_OP_LABEL: Record<string, string> = {
  'integration.aws.list_scope': 'see which AWS accounts/regions and signals you can query',
  'integration.aws.describe_datasets': 'look up AWS datasets and query syntax',
  'integration.aws.query_metrics': 'query CloudWatch metrics',
  'integration.aws.list_metrics': 'discover CloudWatch metric names',
  'integration.aws.error_rate_summary': 'summarize request error rates',
  'integration.aws.latency_summary': 'summarize latency percentiles',
  'integration.aws.query_logs': 'query CloudWatch Logs Insights',
  'integration.aws.list_log_groups': 'discover log groups',
  'integration.aws.log_error_summary': 'summarize error-like log entries',
  'integration.aws.list_traces': 'list X-Ray traces',
  'integration.aws.get_trace': 'read an X-Ray trace',
  'integration.aws.list_alarms': 'list CloudWatch alarm state',
};

const awsSignalFor = (fqName: string): AwsSignal | undefined =>
  AWS_TOOL_SIGNAL[fqName.replace('integration.aws.', '')] as AwsSignal | undefined;

/** Compose an AWS observability skill block from the enabled aws tools + the project's
 *  (account,region) scope. Signal-less tools (list_scope/describe_datasets) are always shown;
 *  the rest are gated by the union of signals across in-scope connections. Returns '' when none. */
export function renderAwsSkill(enabledAwsTools: string[], scope: AwsScopeView): string {
  const granted = new Set<AwsSignal>(scope.signals);
  const enabled = enabledAwsTools.filter((t) => {
    if (!(t in AWS_OP_LABEL)) return false;
    const sig = awsSignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.aws.${t}`);
  const ops = enabled.map((t) => AWS_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## AWS observability tools\n\nThis project can query AWS observability data (read-only) — your second source of truth after the code, used to confirm a hypothesis in production. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **metrics** (error rate / latency) to see *what* changed and *when*, then read **logs** (Logs Insights) to find the failing requests and error messages, then pull **X-Ray traces** to follow a single failing request end-to-end. Quote the query and its result for any claim.',
    'Call `integration.aws.list_scope` first to learn which AWS account/region pairs you may query and which signals each has.',
    'Every query tool takes `account` + `region` — they must be one of the in-scope pairs (they default to the single pair in scope when there is only one).',
    'Bound time queries with `window` (e.g. `"15m"`, `"1h"`, `"7d"`) or explicit start/end ISO timestamps.',
  ];
  if (['error_rate_summary', 'latency_summary', 'log_error_summary'].some((t) => has(t))) {
    bullets.push('Prefer the purpose-built RCA recipes (`error_rate_summary`, `latency_summary`, `log_error_summary`) — they return reliable, pre-shaped results.');
  }
  if (has('describe_datasets')) bullets.push('Call `describe_datasets` before writing a raw `query_metrics` or `query_logs` — it lists namespaces, metrics, and query syntax.');
  if (has('query_logs')) bullets.push('`query_logs` takes a CloudWatch Logs Insights query, e.g. `fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 50`.');
  if (has('list_traces')) bullets.push('`list_traces` accepts an X-Ray filter expression (e.g. `service("api") AND http.status = 500`); follow up with `get_trace` for spans.');
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.scope.length
    ? scope.scope.map((s) => `${s.account}/${s.region}${s.label ? ` (${s.label})` : ''}`).join(', ')
    : '(no AWS accounts/regions configured)';
  parts.push(`**AWS accounts/regions in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type AzureScopeView = {
  signals: AzureSignal[];
  scope: { subscriptionId: string; workspaceId: string | null; label: string | null }[];
};

const AZURE_OP_LABEL: Record<string, string> = {
  'integration.azure.list_scope': 'see which Azure subscriptions/workspaces and signals you can query',
  'integration.azure.describe_datasets': 'look up Azure datasets and query syntax',
  'integration.azure.query_metrics': 'query Azure Monitor metrics',
  'integration.azure.list_metrics': 'discover Azure Monitor metric definitions',
  'integration.azure.query_logs': 'run KQL over Log Analytics',
  'integration.azure.list_tables': 'discover Log Analytics tables',
  'integration.azure.log_error_summary': 'summarize error-like log entries',
  'integration.azure.list_traces': 'list Application Insights failed requests',
  'integration.azure.get_trace': 'read one Application Insights operation end-to-end',
  'integration.azure.error_rate_summary': 'summarize request error rates',
  'integration.azure.latency_summary': 'summarize request latency percentiles',
  'integration.azure.list_alerts': 'list Azure Monitor alert state',
};

const azureSignalFor = (fqName: string): AzureSignal | undefined =>
  AZURE_TOOL_SIGNAL[fqName.replace('integration.azure.', '')] as AzureSignal | undefined;

/** Compose an Azure observability skill block from the enabled azure tools + the project's
 *  (subscription, workspace) scope. Signal-less tools are always shown; the rest are gated by the
 *  union of signals across in-scope connections. Returns '' when none. */
export function renderAzureSkill(enabledAzureTools: string[], scope: AzureScopeView): string {
  const granted = new Set<AzureSignal>(scope.signals);
  const enabled = enabledAzureTools.filter((t) => {
    if (!(t in AZURE_OP_LABEL)) return false;
    const sig = azureSignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.azure.${t}`);
  const ops = enabled.map((t) => AZURE_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Azure observability tools\n\nThis project can query Azure observability data (read-only) — your second source of truth after the code, used to confirm a hypothesis in production. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **metrics** (error rate / latency) to see *what* changed and *when*, then read **logs** (KQL over Log Analytics) to find the failing requests and error messages, then pull **Application Insights traces** to follow a single failing request end-to-end. Quote the query and its result for any claim.',
    'Call `integration.azure.list_scope` first to learn which subscriptions/workspaces you may query and which signals each has.',
    'Metrics/alerts tools take a `subscriptionId`; logs/traces tools take a `workspaceId` — they must be one of the in-scope pairs (they default to the single one in scope when there is only one).',
    'Bound time queries with `window` (e.g. `"15m"`, `"1h"`, `"7d"`) or explicit start/end ISO timestamps.',
  ];
  if (['error_rate_summary', 'latency_summary', 'log_error_summary'].some((t) => has(t))) {
    bullets.push('Prefer the purpose-built RCA recipes (`error_rate_summary`, `latency_summary`, `log_error_summary`) — they return reliable, pre-shaped results from Application Insights.');
  }
  if (has('describe_datasets')) bullets.push('Call `describe_datasets` before writing a raw `query_metrics` or `query_logs` — it lists metric namespaces, KQL tables, and syntax.');
  if (has('query_logs')) bullets.push('`query_logs` takes a KQL query, e.g. `AppExceptions | where TimeGenerated > ago(1h) | summarize count() by ProblemId | order by count_ desc`.');
  if (has('list_traces')) bullets.push('`list_traces` returns failed Application Insights requests (or pass a KQL `filter` fragment); follow up with `get_trace` by OperationId.');
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.scope.length
    ? scope.scope.map((s) => `${s.subscriptionId}${s.workspaceId ? ` / ws:${s.workspaceId}` : ''}${s.label ? ` (${s.label})` : ''}`).join(', ')
    : '(no Azure subscriptions configured)';
  parts.push(`**Azure subscriptions/workspaces in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type DatadogScopeView = {
  signals: DatadogSignal[];
  scope: { env: string; service: string | null; label: string | null }[];
};

const DATADOG_OP_LABEL: Record<string, string> = {
  'integration.datadog.list_scope': 'see which Datadog envs/services and signals you can query',
  'integration.datadog.describe_datasets': 'look up Datadog datasets and query syntax',
  'integration.datadog.query_metrics': 'query Datadog metrics',
  'integration.datadog.list_metrics': 'discover Datadog metric names',
  'integration.datadog.query_logs': 'search Datadog logs',
  'integration.datadog.log_error_summary': 'summarize error-severity log events',
  'integration.datadog.list_traces': 'list APM error spans',
  'integration.datadog.get_trace': 'read one APM trace end-to-end',
  'integration.datadog.error_rate_summary': 'compute request error rate',
  'integration.datadog.latency_summary': 'compute request latency percentiles',
  'integration.datadog.list_monitors': 'list Datadog monitor/alert state',
};

const datadogSignalFor = (fqName: string): DatadogSignal | undefined =>
  DATADOG_TOOL_SIGNAL[fqName.replace('integration.datadog.', '')] as DatadogSignal | undefined;

/** Compose a Datadog observability skill block from the enabled datadog tools + the project's
 *  (env, service?) scope. Signal-less tools are always shown; the rest are gated by the
 *  union of signals across in-scope connections. Returns '' when none. */
export function renderDatadogSkill(enabledDatadogTools: string[], scope: DatadogScopeView): string {
  const granted = new Set<DatadogSignal>(scope.signals);
  const enabled = enabledDatadogTools.filter((t) => {
    if (!(t in DATADOG_OP_LABEL)) return false;
    const sig = datadogSignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.datadog.${t}`);
  const ops = enabled.map((t) => DATADOG_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Datadog observability tools\n\nThis project can query Datadog observability data (read-only) — your second source of truth after the code, used to confirm a hypothesis in production. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **metrics** (error rate / latency) to see *what* changed and *when*, then read **logs** to find the failing requests and error messages, then pull **APM traces** to follow a single failing request end-to-end. Quote the query and its result for any claim.',
    'Call `integration.datadog.list_scope` first to learn which env/service pairs you may query and which signals each has.',
    'Every query tool takes `env` (required) and optional `service` — they must be one of the in-scope pairs (they default to the single pair in scope when there is only one).',
    'Bound time queries with `window` (e.g. `"15m"`, `"1h"`, `"7d"`) or explicit start/end ISO timestamps.',
  ];
  if (['error_rate_summary', 'latency_summary', 'log_error_summary'].some((t) => has(t))) {
    bullets.push('Prefer the purpose-built RCA recipes (`error_rate_summary`, `latency_summary`, `log_error_summary`) — they return reliable, pre-shaped results.');
  }
  if (has('describe_datasets')) bullets.push('Call `describe_datasets` before writing a raw `query_metrics` or `query_logs` — it lists metric names, log facets, span attributes, and query syntax.');
  if (has('query_logs')) bullets.push('`query_logs` takes a Datadog log search string (the env/service scope tags are prepended automatically), e.g. `status:error @http.status_code:500`.');
  if (has('list_traces')) bullets.push('`list_traces` returns error spans for the scoped env/service; follow up with `get_trace` by traceId for the full span waterfall.');
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.scope.length
    ? scope.scope.map((s) => `${s.env}${s.service ? `/${s.service}` : ''}${s.label ? ` (${s.label})` : ''}`).join(', ')
    : 'no Datadog env/services configured';
  parts.push(`**Datadog env/services in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type DynatraceScopeView = {
  signals: DynatraceSignal[];
  scope: { managementZone: string | null; service: string | null; label: string | null }[];
};

const DYNATRACE_OP_LABEL: Record<string, string> = {
  'integration.dynatrace.list_scope': 'see which Dynatrace management zones/services and signals you can query',
  'integration.dynatrace.describe_datasets': 'look up Dynatrace datasets and query syntax',
  'integration.dynatrace.query_metrics': 'query Dynatrace metrics',
  'integration.dynatrace.list_metrics': 'discover Dynatrace metric keys',
  'integration.dynatrace.query_logs': 'search Dynatrace logs',
  'integration.dynatrace.log_error_summary': 'summarize error-severity log events',
  'integration.dynatrace.error_rate_summary': 'compute service error rate',
  'integration.dynatrace.latency_summary': 'compute service latency',
  'integration.dynatrace.list_problems': 'list Dynatrace Davis problems',
  'integration.dynatrace.get_problem': 'read one Dynatrace problem end-to-end',
};

const dynatraceSignalFor = (fqName: string): DynatraceSignal | undefined =>
  DYNATRACE_TOOL_SIGNAL[fqName.replace('integration.dynatrace.', '')] as DynatraceSignal | undefined;

/** Compose a Dynatrace observability skill block from the enabled dynatrace tools + the project's
 *  (managementZone, service?) scope. Signal-less tools are always shown; the rest are gated by the
 *  union of signals across in-scope connections. Returns '' when none. */
export function renderDynatraceSkill(enabledDynatraceTools: string[], scope: DynatraceScopeView): string {
  const granted = new Set<DynatraceSignal>(scope.signals);
  const enabled = enabledDynatraceTools.filter((t) => {
    if (!(t in DYNATRACE_OP_LABEL)) return false;
    const sig = dynatraceSignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.dynatrace.${t}`);
  const ops = enabled.map((t) => DYNATRACE_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## Dynatrace observability tools\n\nThis project can query Dynatrace observability data (read-only) — your second source of truth after the code, used to confirm a hypothesis in production. You can ${ops}.`];

  const bullets: string[] = [
    'Workflow: start with **metrics** (error rate / latency) to see *what* changed and *when*, then read **logs** to find the failing requests and error messages, then check **Davis problems** to see what Dynatrace has already correlated. Quote the query and its result for any claim.',
    'Call `integration.dynatrace.list_scope` first to learn which management zone/service pairs you may query and which signals each has.',
    'Every query tool takes optional `managementZone` and `service` — they default to the single in-scope pair when there is only one.',
    'Bound time queries with `window` (e.g. `"15m"`, `"1h"`, `"7d"`) or explicit `start`/`end` ISO timestamps.',
  ];
  if (['error_rate_summary', 'latency_summary', 'log_error_summary'].some((t) => has(t))) {
    bullets.push('Prefer the purpose-built RCA recipes (`error_rate_summary`, `latency_summary`, `log_error_summary`) — they return reliable, pre-shaped results.');
  }
  if (has('describe_datasets')) bullets.push('Call `describe_datasets` before writing a raw `query_metrics` metric selector or `query_logs` filter — it lists the available metric keys, log attributes, and query syntax.');
  if (has('list_problems') || has('get_problem')) {
    bullets.push('Davis problems (`list_problems` / `get_problem`) surface what Dynatrace has already correlated — check these before constructing raw queries; a problem\'s root-cause entities often point directly to the failing service.');
  }
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.scope.length
    ? scope.scope.map((s) => `${s.managementZone ?? '(all zones)'}${s.service ? `/${s.service}` : ''}${s.label ? ` (${s.label})` : ''}`).join(', ')
    : 'no Dynatrace scope configured';
  parts.push(`**Dynatrace management zones/services in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

export type PagerDutyScopeView = {
  signals: PagerDutySignal[];
  scope: { team: string | null; service: string | null; label: string | null }[];
};

const PAGERDUTY_OP_LABEL: Record<string, string> = {
  'integration.pagerduty.list_scope': 'see which PagerDuty teams/services and signals you can query',
  'integration.pagerduty.describe_datasets': 'look up the PagerDuty incident/alert model and filter syntax',
  'integration.pagerduty.list_services': 'discover PagerDuty services in the account',
  'integration.pagerduty.list_incidents': 'list PagerDuty incidents auto-scoped to this project',
  'integration.pagerduty.get_incident': 'read one PagerDuty incident in full',
  'integration.pagerduty.list_incident_alerts': 'list the raw monitoring-tool alerts grouped into one incident',
  'integration.pagerduty.list_incident_log_entries': 'fetch the chronological timeline of one incident',
};

const pagerdutySignalFor = (fqName: string): PagerDutySignal | undefined =>
  PAGERDUTY_TOOL_SIGNAL[fqName.replace('integration.pagerduty.', '')] as PagerDutySignal | undefined;

/** Compose a PagerDuty incident management skill block from the enabled pagerduty tools + the
 *  project's (team, service?) scope. Signal-less tools are always shown; the rest are gated by the
 *  union of signals across in-scope connections. Returns '' when none. */
export function renderPagerDutySkill(enabledPagerdutyTools: string[], scope: PagerDutyScopeView): string {
  const granted = new Set<PagerDutySignal>(scope.signals);
  const enabled = enabledPagerdutyTools.filter((t) => {
    if (!(t in PAGERDUTY_OP_LABEL)) return false;
    const sig = pagerdutySignalFor(t);
    return !sig || granted.has(sig);
  });
  if (enabled.length === 0) return '';
  const has = (t: string) => enabled.includes(`integration.pagerduty.${t}`);
  const ops = enabled.map((t) => PAGERDUTY_OP_LABEL[t]).join(', ');
  const parts: string[] = [`## PagerDuty incident management tools\n\nThis project can query PagerDuty incidents (read-only) — a source of truth for on-call alerts, used to find what fired and when. You can ${ops}.`];

  const bullets: string[] = [
    'Call `integration.pagerduty.list_scope` first to learn which teams/services you may query and which signals each connection has.',
  ];
  if (has('list_incidents')) {
    bullets.push('Call `list_incidents` to see what fired (auto-scoped to this project\'s teams/services); drill in with `get_incident` / `list_incident_alerts` / `list_incident_log_entries`. Use the incident onset time to correlate with recent deploys.');
    bullets.push('`list_incidents` is pre-scoped to this project\'s teams/services — only pass explicit `teamIds`/`serviceIds` to narrow further. Defaults to the last 7 days, all statuses.');
  }
  if (has('describe_datasets')) {
    bullets.push('Call `describe_datasets` before writing complex `list_incidents` filters — it covers the incident/alert model and available filter fields.');
  }
  if (has('list_incident_alerts') || has('list_incident_log_entries')) {
    bullets.push('`list_incident_alerts` gives the raw monitoring-tool alerts grouped into the incident; `list_incident_log_entries` gives the full chronological timeline (trigger/notify/ack/escalate/resolve).');
  }
  parts.push(bullets.map((b) => `- ${b}`).join('\n'));

  const scopeLine = scope.scope.length
    ? scope.scope.map((s) => `${s.team ?? '(all teams)'}${s.service ? `/${s.service}` : ''}${s.label ? ` (${s.label})` : ''}`).join(', ')
    : 'no PagerDuty teams/services configured';
  parts.push(`**PagerDuty teams/services in scope:** ${scopeLine}`);
  return parts.join('\n\n') + '\n';
}

/** Focused guidance for the GitHub issue hand-off tool. Appended only when the tool is enabled. */
export function renderGithubIssueSkill(): string {
  return [
    '## Raising a fix issue',
    'When — and ONLY when — the team has reached a conclusion AND the problem is fixable in code, you may raise a GitHub issue (it may be handed to GitHub Copilot, depending on how the project is configured).',
    '- Call `integration.github.offer_github_issue` exactly once, as your final action, AFTER writing your conclusion. Do NOT call it for inconclusive investigations, infra/config-only problems, or anything not fixable by a code change.',
    '- Draft a complete issue: a clear `title`, and a `body` with the root cause, affected files (as file:line), how to reproduce, and expected vs actual — everything a coding agent needs to fix it without more context.',
    '- Set `repo` to the repository where the fix belongs when the evidence points to one; omit `repo` if unsure and the reporter will be asked to choose.',
    '- `summary` is one line shown on the Slack prompt. The reporter clicks to confirm — you do not create the issue yourself.',
  ].join('\n') + '\n';
}

/** Append system messages carrying each integration's skill, tailored to the
 *  assistant's enabled integration tools. No-op for providers with no enabled tools.
 *
 *  When `opts.preamble` is true, the shared RCA operating-instructions preamble is
 *  inserted as a system message immediately AFTER the persona (assumed to be the first
 *  message) and BEFORE the integration skill blocks. This is for investigator assistants;
 *  the Slack system agent passes `preamble:false` (its persona is self-contained). */
export async function appendIntegrationSkills(
  db: Db,
  projectId: string,
  enabledTools: string[],
  messages: Msg[],
  opts?: { preamble?: boolean; assistantId?: string },
): Promise<Msg[]> {
  const out = [...messages];

  if (opts?.preamble) {
    // Insert right after the persona system message (index 0) so it leads the prompt
    // before any integration skill blocks. Guard against accidental duplication.
    const already = out.some((m) => m.content === RCA_OPERATING_PREAMBLE);
    if (!already) {
      const insertAt = out[0]?.role === 'system' ? 1 : 0;
      out.splice(insertAt, 0, { role: 'system', content: RCA_OPERATING_PREAMBLE });
    }
  }

  const githubTools = enabledTools.filter((t) => t.startsWith('integration.github.'));
  if (githubTools.length > 0) {
    const repos = await listProjectRepos(db, projectId);
    const block = renderGithubSkill(
      githubTools,
      repos.map((r) => ({ repo: r.repoFullName, ref: resolveRepoRef(r) })),
    );
    if (block) out.push({ role: 'system', content: block });
  }

  const slackTools = enabledTools.filter((t) => t.startsWith('integration.slack.'));
  if (slackTools.length > 0) {
    const channels = await listSlackBindingsByProject(db, projectId);
    const block = renderSlackSkill(
      slackTools,
      channels.map((c) => ({ name: c.channelName, id: c.slackChannelId })),
    );
    if (block) out.push({ role: 'system', content: block });
  }

  const kgTools = enabledTools.filter((t) => t.startsWith('integration.knowledge-graph.'));
  if (kgTools.length > 0) {
    const repos = await listProjectRepos(db, projectId);
    const block = renderKnowledgeGraphSkill(kgTools, repos.map((r) => r.repoFullName));
    if (block) out.push({ role: 'system', content: block });
  }

  const gcpTools = enabledTools.filter((t) => t.startsWith('integration.gcp.'));
  if (gcpTools.length > 0) {
    const binding = await getGcpProjectConnection(db, projectId);
    if (binding) {
      const conn = await getGcpConnection(db, binding.orgId, binding.connectionId);
      const signals = (conn?.metadata as GcpConnectionMetadata)?.availableSignals ?? [];
      const targets = await listGcpTargets(db, projectId);
      const block = renderGcpSkill(gcpTools, {
        unrestricted: targets.length === 0,
        signals,
        projects: targets.map((t) => ({ gcpProjectId: t.gcpProjectId, label: t.label })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const cloudflareTools = enabledTools.filter((t) => t.startsWith('integration.cloudflare.'));
  if (cloudflareTools.length > 0) {
    const binding = await getProjectConnection(db, projectId);
    if (binding) {
      const conn = await getConnection(db, binding.orgId, binding.connectionId);
      const account = (conn?.metadata as { accountId?: string })?.accountId ?? null;
      const resources = await listCloudflareTargets(db, projectId);
      const block = renderCloudflareSkill(cloudflareTools, {
        account,
        unrestricted: resources.length === 0,
        resources: resources.map((t) => ({ kind: t.kind, name: t.name })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const sentryTools = enabledTools.filter((t) => t.startsWith('integration.sentry.'));
  if (sentryTools.length > 0) {
    const binding = await getSentryProjectConnection(db, projectId);
    if (binding) {
      const conn = await getSentryConnection(db, binding.orgId, binding.connectionId);
      const org = (conn?.metadata as { sentryOrgSlug?: string })?.sentryOrgSlug ?? null;
      const targets = await listSentryTargets(db, projectId);
      const block = renderSentrySkill(sentryTools, {
        org,
        unrestricted: targets.length === 0,
        projects: targets.map((t) => ({ slug: t.sentryProjectSlug, name: t.name })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const grafanaTools = enabledTools.filter((t) => t.startsWith('integration.grafana.'));
  if (grafanaTools.length > 0) {
    const binding = await getGrafanaProjectConnection(db, projectId);
    if (binding) {
      const conn = await getGrafanaConnection(db, binding.orgId, binding.connectionId);
      const meta = (conn?.metadata as { availableSignals?: GrafanaSignal[]; datasources?: { uid: string; type: string; name: string }[] }) ?? {};
      const targets = await listGrafanaTargets(db, projectId);
      const datasources = targets.length === 0
        ? (meta.datasources ?? [])
        : targets.map((t) => ({ uid: t.datasourceUid, type: t.datasourceType, name: t.name }));
      const block = renderGrafanaSkill(grafanaTools, {
        unrestricted: targets.length === 0,
        signals: meta.availableSignals ?? [],
        datasources,
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const awsTools = enabledTools.filter((t) => t.startsWith('integration.aws.'));
  if (awsTools.length > 0) {
    const targets = await listAwsTargets(db, projectId);
    if (targets.length > 0) {
      const orgId = await getProjectOrgId(db, projectId);
      const conns = orgId ? await listAwsConnectionsForProject(db, orgId, projectId) : [];
      const used = new Set(targets.map((t) => t.connectionId));
      const signals = new Set<AwsSignal>();
      for (const c of conns) {
        if (!used.has(c.id)) continue;
        for (const s of ((c.metadata as { availableSignals?: AwsSignal[] })?.availableSignals ?? [])) signals.add(s);
      }
      const block = renderAwsSkill(awsTools, {
        signals: [...signals],
        scope: targets.map((t) => ({ account: t.awsAccountId, region: t.awsRegion, label: t.label })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const azureTools = enabledTools.filter((t) => t.startsWith('integration.azure.'));
  if (azureTools.length > 0) {
    const targets = await listAzureTargets(db, projectId);
    if (targets.length > 0) {
      const orgId = await getProjectOrgId(db, projectId);
      const conns = orgId ? await listAzureConnectionsForProject(db, orgId, projectId) : [];
      const used = new Set(targets.map((t) => t.connectionId));
      const hasWorkspace = targets.some((t) => t.logAnalyticsWorkspaceId);
      const signals = new Set<AzureSignal>();
      for (const c of conns) {
        if (!used.has(c.id)) continue;
        for (const s of ((c.metadata as { availableSignals?: AzureSignal[] })?.availableSignals ?? [])) signals.add(s);
      }
      if (!hasWorkspace) { signals.delete('logs'); signals.delete('traces'); }
      const block = renderAzureSkill(azureTools, {
        signals: [...signals],
        scope: targets.map((t) => ({ subscriptionId: t.subscriptionId, workspaceId: t.logAnalyticsWorkspaceId, label: t.label })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const datadogTools = enabledTools.filter((t) => t.startsWith('integration.datadog.'));
  if (datadogTools.length > 0) {
    const targets = await listDatadogTargets(db, projectId);
    if (targets.length > 0) {
      const orgId = await getProjectOrgId(db, projectId);
      const conns = orgId ? await listDatadogConnectionsForProject(db, orgId, projectId) : [];
      const used = new Set(targets.map((t) => t.connectionId));
      const signals = new Set<DatadogSignal>();
      for (const c of conns) {
        if (!used.has(c.id) || !c.enabled) continue;
        for (const s of ((c.metadata as { availableSignals?: DatadogSignal[] })?.availableSignals ?? [])) signals.add(s);
      }
      const block = renderDatadogSkill(datadogTools, {
        signals: [...signals],
        scope: targets.map((t) => ({ env: t.env, service: t.service, label: t.label })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const dynatraceTools = enabledTools.filter((t) => t.startsWith('integration.dynatrace.'));
  if (dynatraceTools.length > 0) {
    const targets = await listDynatraceTargets(db, projectId);
    if (targets.length > 0) {
      const orgId = await getProjectOrgId(db, projectId);
      const conns = orgId ? await listDynatraceConnectionsForProject(db, orgId, projectId) : [];
      const used = new Set(targets.map((t) => t.connectionId));
      const signals = new Set<DynatraceSignal>();
      for (const c of conns) {
        if (!used.has(c.id) || !c.enabled) continue;
        for (const s of ((c.metadata as { availableSignals?: DynatraceSignal[] })?.availableSignals ?? [])) signals.add(s);
      }
      const block = renderDynatraceSkill(dynatraceTools, {
        signals: [...signals],
        scope: targets.map((t) => ({ managementZone: t.managementZone, service: t.service, label: t.label })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  const pagerdutyTools = enabledTools.filter((t) => t.startsWith('integration.pagerduty.'));
  if (pagerdutyTools.length > 0) {
    const targets = await listPagerDutyTargets(db, projectId);
    if (targets.length > 0) {
      const orgId = await getProjectOrgId(db, projectId);
      const conns = orgId ? await listPagerDutyConnectionsForProject(db, orgId, projectId) : [];
      const used = new Set(targets.map((t) => t.connectionId));
      const signals = new Set<PagerDutySignal>();
      for (const c of conns) {
        if (!used.has(c.id) || !c.enabled) continue;
        for (const s of ((c.metadata as { availableSignals?: PagerDutySignal[] })?.availableSignals ?? [])) signals.add(s);
      }
      const block = renderPagerDutySkill(pagerdutyTools, {
        signals: [...signals],
        scope: targets.map((t) => ({ team: t.teamName ?? t.teamId, service: t.serviceName ?? t.serviceId, label: t.label })),
      });
      if (block) out.push({ role: 'system', content: block });
    }
  }

  if (enabledTools.includes('integration.github.offer_github_issue')) {
    out.push({ role: 'system', content: renderGithubIssueSkill() });
  }

  // Flat-tool usage guidance from the engine registry (single source of truth, shared with the
  // engine sub-agent path). Server turns have no incident concept and already inject these whenever
  // the tool is held, so pass incidentStart: true.
  for (const content of toolGuidanceBlocks(enabledTools, { incidentStart: true })) {
    out.push({ role: 'system', content });
  }

  if (opts?.assistantId) {
    const skills = await listAttachedSkills(db, opts.assistantId);
    const block = renderSkillsBlock(skills);
    if (block) out.push({ role: 'system', content: block });
  }

  return out;
}
