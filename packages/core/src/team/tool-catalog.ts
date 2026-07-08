/**
 * Canonical integration tool-name lists used by the autogen composer to equip
 * the orchestrator and specialists.
 *
 * SOURCE OF TRUTH for the runtime tool names these mirror:
 *  - CODE_TOOLS                     -> apps/server/src/integrations/github/tools.ts (githubToolDefs)
 *  - GCP_OBSERVABILITY_TOOLS        -> apps/server/src/integrations/gcp/tools.ts (gcpToolDefs)
 *  - CLOUDFLARE_OBSERVABILITY_TOOLS -> apps/server/src/integrations/cloudflare/tools.ts (cloudflareToolDefs)
 *  - AWS_OBSERVABILITY_TOOLS        -> apps/server/src/integrations/aws/tools.ts (awsToolDefs)
 *
 * core can't import from apps/server, so the names are duplicated here. The
 * observability lists are a SUPERSET of the names referenced by the signal
 * skills (packages/core/src/signals/skills/*.ts); tool-catalog.test.ts asserts
 * every signal-skill tool is present here so the two stay in sync.
 */

/** GitHub code-source read tools. A connected code source is a generation
 *  precondition, so these are ALWAYS available for assignment. (Issue/PR tools
 *  like get_issue/create_issue are intentionally excluded — not code-source.) */
export const CODE_TOOLS: string[] = [
  'integration.github.list_repos',
  'integration.github.get_file',
  'integration.github.list_directory',
  'integration.github.search_code',
  'integration.github.get_ref_info',
  'integration.github.list_commits',
  'integration.github.get_commit',
];

/** GCP metrics/logs/traces/errors RCA tools (Cloud Monitoring, Logging, Trace,
 *  Error Reporting). */
export const GCP_OBSERVABILITY_TOOLS: string[] = [
  'integration.gcp.list_scope',
  'integration.gcp.describe_datasets',
  'integration.gcp.query_metrics',
  'integration.gcp.query_logs',
  'integration.gcp.list_traces',
  'integration.gcp.get_trace',
  'integration.gcp.list_metric_descriptors',
  'integration.gcp.error_rate_summary',
  'integration.gcp.latency_summary',
  'integration.gcp.log_error_summary',
  'integration.gcp.list_error_groups',
  'integration.gcp.get_error_group',
];

/** Cloudflare metrics/logs/errors RCA tools (GraphQL Analytics + Workers
 *  Observability). */
export const CLOUDFLARE_OBSERVABILITY_TOOLS: string[] = [
  'integration.cloudflare.list_scope',
  'integration.cloudflare.describe_datasets',
  'integration.cloudflare.query_graphql',
  'integration.cloudflare.http_error_summary',
  'integration.cloudflare.latency_summary',
  'integration.cloudflare.firewall_events',
  'integration.cloudflare.worker_errors',
  'integration.cloudflare.query_worker_logs',
];

/** AWS metrics/logs/traces/alarms RCA tools (CloudWatch Metrics, Logs Insights,
 *  X-Ray, CloudWatch Alarms). */
export const AWS_OBSERVABILITY_TOOLS: string[] = [
  'integration.aws.list_scope',
  'integration.aws.describe_datasets',
  'integration.aws.query_metrics',
  'integration.aws.list_metrics',
  'integration.aws.error_rate_summary',
  'integration.aws.latency_summary',
  'integration.aws.query_logs',
  'integration.aws.list_log_groups',
  'integration.aws.log_error_summary',
  'integration.aws.list_traces',
  'integration.aws.get_trace',
  'integration.aws.list_alarms',
];

/** Azure metrics/logs/traces/alerts RCA tools (Azure Monitor Metrics, Log
 *  Analytics KQL, Application Insights, Azure Monitor Alerts). */
export const AZURE_OBSERVABILITY_TOOLS: string[] = [
  'integration.azure.list_scope',
  'integration.azure.describe_datasets',
  'integration.azure.query_metrics',
  'integration.azure.list_metrics',
  'integration.azure.query_logs',
  'integration.azure.list_tables',
  'integration.azure.log_error_summary',
  'integration.azure.list_traces',
  'integration.azure.get_trace',
  'integration.azure.error_rate_summary',
  'integration.azure.latency_summary',
  'integration.azure.list_alerts',
];

/** Datadog metrics/logs/APM traces/monitors RCA tools (Datadog Metrics,
 *  Logs Search/Aggregation, APM Spans, Monitors). */
export const DATADOG_OBSERVABILITY_TOOLS: string[] = [
  'integration.datadog.list_scope',
  'integration.datadog.describe_datasets',
  'integration.datadog.query_metrics',
  'integration.datadog.list_metrics',
  'integration.datadog.query_logs',
  'integration.datadog.log_error_summary',
  'integration.datadog.list_traces',
  'integration.datadog.get_trace',
  'integration.datadog.error_rate_summary',
  'integration.datadog.latency_summary',
  'integration.datadog.list_monitors',
];

/** Dynatrace metrics/logs/Davis-problems RCA tools (Environment API v2). */
export const DYNATRACE_OBSERVABILITY_TOOLS: string[] = [
  'integration.dynatrace.list_scope',
  'integration.dynatrace.describe_datasets',
  'integration.dynatrace.query_metrics',
  'integration.dynatrace.list_metrics',
  'integration.dynatrace.query_logs',
  'integration.dynatrace.log_error_summary',
  'integration.dynatrace.error_rate_summary',
  'integration.dynatrace.latency_summary',
  'integration.dynatrace.list_problems',
  'integration.dynatrace.get_problem',
];

/** PagerDuty incidents/alerts RCA tools (REST API v2). */
export const PAGERDUTY_OBSERVABILITY_TOOLS: string[] = [
  'integration.pagerduty.list_scope',
  'integration.pagerduty.describe_datasets',
  'integration.pagerduty.list_services',
  'integration.pagerduty.list_incidents',
  'integration.pagerduty.get_incident',
  'integration.pagerduty.list_incident_alerts',
  'integration.pagerduty.list_incident_log_entries',
];

/** Memory recall tool given to every investigating agent. */
export const MEMORY_RECALL_TOOL = 'memory.recall';

/** The full set of tools the autogen composer may assign. Code tools are always
 *  present; observability tools are gated on the connected integrations. Slack
 *  tools are NEVER included (comms is the Slack system agent's job). */
export function availableToolCatalog(connected: { gcp: boolean; cloudflare: boolean; aws: boolean; azure?: boolean; datadog?: boolean; dynatrace?: boolean; pagerduty?: boolean }): string[] {
  return [
    ...CODE_TOOLS,
    ...(connected.gcp ? GCP_OBSERVABILITY_TOOLS : []),
    ...(connected.cloudflare ? CLOUDFLARE_OBSERVABILITY_TOOLS : []),
    ...(connected.aws ? AWS_OBSERVABILITY_TOOLS : []),
    ...(connected.azure ? AZURE_OBSERVABILITY_TOOLS : []),
    ...(connected.datadog ? DATADOG_OBSERVABILITY_TOOLS : []),
    ...(connected.dynatrace ? DYNATRACE_OBSERVABILITY_TOOLS : []),
    ...(connected.pagerduty ? PAGERDUTY_OBSERVABILITY_TOOLS : []),
    MEMORY_RECALL_TOOL,
  ];
}
