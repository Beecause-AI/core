export interface AzureAllowed { pairs: Set<string> }

/** Stable key for a (subscription, workspace?) scope pair. */
export function azureScopeKey(subscriptionId: string, workspaceId: string | null): string {
  return `${subscriptionId}::${workspaceId ?? ''}`;
}

export function validateAzureScope(
  subscriptionId: string, workspaceId: string | null, allowed: AzureAllowed,
): { ok: true } | { ok: false; error: string } {
  if (allowed.pairs.has(azureScopeKey(subscriptionId, workspaceId))) return { ok: true };
  return { ok: false, error: `subscription/workspace ${subscriptionId}/${workspaceId ?? '(none)'} is not in this project's Azure scope` };
}

/** Active tables in a workspace over the last day (cheap discovery, ≈ AWS log groups). */
export function usageTablesKql(): string {
  return 'Usage | where TimeGenerated > ago(24h) | distinct DataType | order by DataType asc';
}

/** Error-like log entries across App Insights traces/exceptions. */
export function logErrorKql(limit = 50): string {
  return `union AppExceptions, (AppTraces | where SeverityLevel >= 3) | order by TimeGenerated desc | take ${limit}`;
}

/** Request error rate over the query window from App Insights request telemetry. */
export function errorRateKql(): string {
  return 'AppRequests | summarize total = count(), errors = countif(Success == false) | extend errorRatePct = iff(total == 0, 0.0, round(100.0 * errors / total, 2))';
}

/** Request latency percentiles (p50/p95/p99) from App Insights request telemetry. */
export function latencyKql(): string {
  return 'AppRequests | summarize p50 = percentiles(DurationMs, 50), p95 = percentiles(DurationMs, 95), p99 = percentiles(DurationMs, 99), count()';
}

/** Failed requests (optionally constrained by a KQL where-fragment). */
export function listTracesKql(filter: string | undefined, limit = 50): string {
  const where = filter ? `| where ${filter}` : '| where Success == false';
  return `AppRequests ${where} | project TimeGenerated, OperationId, Name, ResultCode, DurationMs, Success | order by TimeGenerated desc | take ${limit}`;
}

/** All telemetry for one end-to-end operation, correlated by OperationId. */
export function getTraceKql(operationId: string): string {
  const safe = operationId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `union AppRequests, AppDependencies, AppExceptions, AppTraces | where OperationId == "${safe}" | project TimeGenerated, itemType = Type, Name, DependencyType = column_ifexists("DependencyType", ""), ResultCode = column_ifexists("ResultCode", ""), DurationMs = column_ifexists("DurationMs", real(null)), Message = column_ifexists("Message", "") | order by TimeGenerated asc`;
}
