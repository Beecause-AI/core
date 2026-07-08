/** Static reference returned by integration.azure.describe_datasets — what the raw tools can
 *  query, so the model writes valid Azure Monitor metric queries and KQL. */
export const AZURE_DATASETS_REFERENCE = `# Azure datasets for RCA

Call \`list_scope\` first to see the allowed (subscription, Log Analytics workspace) pairs.
Metrics/alerts tools take a \`subscriptionId\`; logs/traces tools take a \`workspaceId\` — both must be in scope.

## Azure Monitor Metrics (query_metrics / list_metrics)
- query_metrics takes { subscriptionId, resourceId, metricNames:[...], aggregations:["Average"|"Total"|"Maximum"|"Minimum"|"Count"], period(seconds) }.
  resourceId is the full ARM id, e.g. /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Web/sites/<app>.
- Common metric namespaces by resource: Microsoft.Web/sites (Http5xx, Requests, HttpResponseTime),
  Microsoft.Insights/components (requests/failed, requests/duration), Microsoft.ContainerService/managedClusters,
  Microsoft.DBforPostgreSQL, Microsoft.ServiceBus, Microsoft.Storage.
- list_metrics(subscriptionId, resourceId) discovers the metric definitions for a resource.
- Azure metrics expose Average/Total/Max/Min/Count only — for latency PERCENTILES and error RATE, use the
  Application Insights recipes below (latency_summary / error_rate_summary), which run KQL.

## Azure Monitor Logs — KQL (query_logs / list_tables / log_error_summary)
- query_logs takes { workspaceId, query } where query is KQL, e.g.
  'AppExceptions | where TimeGenerated > ago(1h) | summarize count() by ProblemId | order by count_ desc'.
- list_tables(workspaceId) lists the tables active in the workspace (last 24h).
- Common tables: AppTraces, AppExceptions, AppRequests, AppDependencies, ContainerLogV2, Syslog, AzureDiagnostics.

## Application Insights traces (list_traces / get_trace / error_rate_summary / latency_summary)
- These run KQL against the workspace-based App Insights request tables (AppRequests / AppDependencies / AppExceptions),
  correlated by OperationId. They require a workspace in scope (the 'traces' signal).
- list_traces returns failed requests (or pass a KQL where-fragment as 'filter', e.g. 'ResultCode == "500"').
- get_trace(operationId) returns all telemetry for one end-to-end operation.
- error_rate_summary / latency_summary compute request error-rate % and p50/p95/p99 duration from AppRequests.

## Azure Monitor Alerts (list_alerts)
- list_alerts(subscriptionId) returns alert instances and their state; pass monitorCondition "Fired" for firing only.

Prefer the recipe tools (error_rate_summary, latency_summary, log_error_summary) for common RCA questions;
use the raw tools for anything they don't cover.`;
