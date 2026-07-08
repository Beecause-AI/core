import {
  listAzureTargets, listAzureConnectionsForProject, getAzureConnection,
  credsForAzureConnection, resolveAzureCredential, validateAzureScope, azureScopeKey,
  usageTablesKql, logErrorKql, errorRateKql, latencyKql, listTracesKql, getTraceKql, realAzureClient,
  type Db, type AzureClient, type AzureCreds, type AzureAuthConfig, type AzureAllowed,
} from '@intellilabs/core';
import { AZURE_DATASETS_REFERENCE } from './datasets.js';

type TokenCredential = ReturnType<typeof resolveAzureCredential>;

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean }
export interface ToolResult { content: string; isError?: boolean }
export interface AzureToolCtx { db: Db; orgId: string; projectId: string; config: AzureAuthConfig; client?: AzureClient }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const A = { type: 'array', items: S } as const;

export type AzureSignalKind = 'metrics' | 'logs' | 'traces' | 'alerts';

export const SIGNAL_OF: Record<string, AzureSignalKind> = {
  query_metrics: 'metrics', list_metrics: 'metrics',
  query_logs: 'logs', list_tables: 'logs', log_error_summary: 'logs',
  list_traces: 'traces', get_trace: 'traces', error_rate_summary: 'traces', latency_summary: 'traces',
  list_alerts: 'alerts',
};

/** Whether a tool is scoped by subscription (metrics/alerts) or by workspace (logs/traces). */
const WORKSPACE_SCOPED = new Set(['query_logs', 'list_tables', 'log_error_summary', 'list_traces', 'get_trace', 'error_rate_summary', 'latency_summary']);

export function azureToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.azure.${name}`, description, parameters, kind: 'integration', mutates: false });
  const sub = { subscriptionId: S };
  const ws = { workspaceId: S, subscriptionId: S };
  const win = { window: S, start: S, end: S };
  return [
    d('list_scope', "List the Azure (subscription, Log Analytics workspace) pairs this project's assistants can query, and which signals each has.", obj({}, [])),
    d('describe_datasets', 'Reference for Azure metrics/logs/traces/alerts and how to write metric queries + KQL. Call before writing a raw query.', obj({}, [])),
    d('query_metrics', 'Fetch Azure Monitor metrics for a resource. Provide subscriptionId + resourceId (full ARM id) + metricNames + aggregations + period seconds, bounded by window OR start/end.', obj({ ...sub, resourceId: S, metricNames: A, aggregations: A, period: N, ...win }, ['subscriptionId', 'resourceId', 'metricNames'])),
    d('list_metrics', 'Discover the Azure Monitor metric definitions for a resource (subscriptionId + resourceId).', obj({ ...sub, resourceId: S }, ['subscriptionId', 'resourceId'])),
    d('query_logs', 'Run a KQL query against a Log Analytics workspace. Provide workspaceId + query, bounded by window OR start/end.', obj({ ...ws, query: S, ...win }, ['workspaceId', 'query'])),
    d('list_tables', 'List the tables active in a Log Analytics workspace (last 24h).', obj({ ...ws }, ['workspaceId'])),
    d('log_error_summary', 'Recent error-like log entries (exceptions + high-severity traces) in a workspace over a window.', obj({ ...ws, limit: N, ...win }, ['workspaceId'])),
    d('list_traces', 'List Application Insights failed requests in a workspace (or pass a KQL where-fragment as filter) over a window.', obj({ ...ws, filter: S, limit: N, ...win }, ['workspaceId'])),
    d('get_trace', 'Fetch all Application Insights telemetry for one operation (from list_traces) by OperationId.', obj({ ...ws, operationId: S }, ['workspaceId', 'operationId'])),
    d('error_rate_summary', 'Application Insights request error-rate % over a window (errors ÷ total) for a workspace.', obj({ ...ws, ...win }, ['workspaceId'])),
    d('latency_summary', 'Application Insights request latency p50/p95/p99 over a window for a workspace.', obj({ ...ws, ...win }, ['workspaceId'])),
    d('list_alerts', 'List Azure Monitor alert instances and their state for a subscription (pass monitorCondition "Fired" for firing only).', obj({ ...sub, monitorCondition: S, limit: N }, ['subscriptionId'])),
  ];
}

export function filterAzureToolDefs(defs: ToolDef[], ctx: { hasScope: boolean; signals: Set<AzureSignalKind> }): ToolDef[] {
  if (!ctx.hasScope) return [];
  return defs.filter((def) => {
    const bare = def.name.replace('integration.azure.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

export async function callAzureTool(ctx: AzureToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.azure.', '');

  const targets = await listAzureTargets(ctx.db, ctx.projectId);
  if (targets.length === 0) return { content: 'no Azure scope configured for this project', isError: true };

  if (bare === 'list_scope') {
    const conns = await listAzureConnectionsForProject(ctx.db, ctx.orgId, ctx.projectId);
    const sigOf = (id: string) => ((conns.find((c) => c.id === id)?.metadata as { availableSignals?: string[] })?.availableSignals ?? []);
    return { content: JSON.stringify({
      scope: targets.map((t) => ({ subscriptionId: t.subscriptionId, workspaceId: t.logAnalyticsWorkspaceId, region: t.region, label: t.label, signals: sigOf(t.connectionId) })),
    }) };
  }
  if (bare === 'describe_datasets') return { content: AZURE_DATASETS_REFERENCE };

  // Resolve which target this call addresses, validating against scope.
  const allowed: AzureAllowed = { pairs: new Set(targets.map((t) => azureScopeKey(t.subscriptionId, t.logAnalyticsWorkspaceId))) };
  let target;
  if (WORKSPACE_SCOPED.has(bare)) {
    const withWs = targets.filter((t) => t.logAnalyticsWorkspaceId);
    let workspaceId: string | undefined = args.workspaceId;
    if (!workspaceId && withWs.length === 1) workspaceId = withWs[0]!.logAnalyticsWorkspaceId!;
    if (!workspaceId) return { content: 'workspaceId is required (multiple in scope — see list_scope)', isError: true };
    target = targets.find((t) => t.logAnalyticsWorkspaceId === workspaceId && (!args.subscriptionId || t.subscriptionId === args.subscriptionId));
    if (!target) return { content: `workspace ${workspaceId} is not in this project's Azure scope`, isError: true };
  } else {
    let subscriptionId: string | undefined = args.subscriptionId;
    if (!subscriptionId && targets.length === 1) subscriptionId = targets[0]!.subscriptionId;
    if (!subscriptionId) return { content: 'subscriptionId is required (multiple in scope — see list_scope)', isError: true };
    const check = validateAzureScope(subscriptionId, null, allowed);
    target = targets.find((t) => t.subscriptionId === subscriptionId);
    if (!target && check.ok === false) return { content: check.error, isError: true };
    if (!target) return { content: `subscription ${subscriptionId} is not in this project's Azure scope`, isError: true };
  }

  let cred: TokenCredential;
  try {
    const conn = await getAzureConnection(ctx.db, ctx.orgId, target.connectionId);
    if (!conn) return { content: 'Azure connection not found', isError: true };
    cred = resolveAzureCredential(credsForAzureConnection(conn, ctx.config), ctx.config);
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }

  const client = ctx.client ?? realAzureClient;
  const win = { window: args.window, start: args.start, end: args.end };
  const sub = target.subscriptionId;
  const ws = target.logAnalyticsWorkspaceId!;
  try {
    switch (bare) {
      case 'query_metrics':
        return { content: JSON.stringify(await client.queryMetrics(cred, { subscriptionId: sub, resourceId: String(args.resourceId), metricNames: args.metricNames ?? [], aggregations: args.aggregations, period: args.period, ...win })) };
      case 'list_metrics':
        return { content: JSON.stringify(await client.listMetrics(cred, { subscriptionId: sub, resourceId: String(args.resourceId) })) };
      case 'query_logs':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: String(args.query), ...win })) };
      case 'list_tables':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: usageTablesKql(), window: '24h' })) };
      case 'log_error_summary':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: logErrorKql(args.limit ?? 50), ...win })) };
      case 'list_traces':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: listTracesKql(args.filter, args.limit ?? 50), ...win })) };
      case 'get_trace':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: getTraceKql(String(args.operationId)), window: '24h' })) };
      case 'error_rate_summary':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: errorRateKql(), ...win })) };
      case 'latency_summary':
        return { content: JSON.stringify(await client.queryLogs(cred, { workspaceId: ws, query: latencyKql(), ...win })) };
      case 'list_alerts':
        return { content: JSON.stringify(await client.listAlerts(cred, { subscriptionId: sub, monitorCondition: args.monitorCondition, limit: args.limit })) };
      default:
        return { content: `unknown azure tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
