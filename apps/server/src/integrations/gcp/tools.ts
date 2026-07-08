import {
  getGcpProjectConnection, getGcpConnection, listGcpTargets,
  credsForConnection, validateGcpScope,
  errorRatePromQL, latencyPromQL, logErrorFilter,
  realGcpClient, mintToken, GCP_READONLY_SCOPES, GCP_ERRORREPORTING_SCOPES,
  type Db, type GcpClient, type GcpAllowed, type GcpCreds,
} from '@intellilabs/core';
import { GCP_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean; }
export interface ToolResult { content: string; isError?: boolean; }
export interface GcpToolCtx { db: Db; orgId: string; projectId: string; config: { SECRETS_KEY?: string }; client?: GcpClient; }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;

export function gcpToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.gcp.${name}`, description, parameters, kind: 'integration', mutates: false });
  const projWin = obj({ gcpProject: S, window: S, start: S, end: S }, []);
  return [
    d('list_scope', "List what this project's assistants can query: the bound GCP connection and the allowed GCP projects (with labels), or 'unrestricted' = any project the service account can access.", obj({}, [])),
    d('describe_datasets', 'Reference for GCP metrics/logs/traces datasets and how to write query_metrics PromQL and query_logs filters. Call before writing a raw query.', obj({}, [])),
    d('query_metrics', 'Run a PromQL query against Cloud Monitoring. Omit step for an instant query; pass step (e.g. "60s") for a range query. Bound the time range with window OR explicit start/end ISO timestamps. `gcpProject` must be in scope (required if scope is unrestricted).', obj({ gcpProject: S, query: S, window: S, start: S, end: S, step: S }, ['query'])),
    d('query_logs', 'Query Cloud Logging with a filter (Logging query language). `gcpProject` must be in scope. Bound the time range with window OR explicit start/end ISO timestamps.', obj({ gcpProject: S, filter: S, window: S, start: S, end: S, limit: N, order: S }, ['filter'])),
    d('list_traces', 'List Cloud Trace traces matching an optional filter over a time range. `gcpProject` must be in scope.', obj({ gcpProject: S, filter: S, window: S, start: S, end: S, limit: N }, [])),
    d('get_trace', 'Fetch one trace and its spans by traceId. `gcpProject` must be in scope.', obj({ gcpProject: S, traceId: S }, ['traceId'])),
    d('list_metric_descriptors', 'List Cloud Monitoring metric descriptors (optionally by metric.type prefix) to discover metric names for PromQL. `gcpProject` must be in scope.', obj({ gcpProject: S, prefix: S }, [])),
    d('error_rate_summary', 'Request error-rate breakdown by response code class over a window (RCA). Prefer over raw query_metrics.', projWin),
    d('latency_summary', 'Request latency p50/p95/p99 over a window (RCA).', projWin),
    d('log_error_summary', 'Count + sample of severity>=ERROR log entries over a window (RCA).', projWin),
    d('list_error_groups', 'List the top Cloud Error Reporting error groups over a window (count, affected users, first/last seen, representative message), ordered by count. `gcpProject` must be in scope. Use the returned group id with get_error_group for detail.', obj({ gcpProject: S, window: S, limit: N }, [])),
    d('get_error_group', 'Fetch one Cloud Error Reporting group by groupId: its stats plus a sample of recent events with stack traces. The groupId comes from list_error_groups. `gcpProject` must be in scope.', obj({ gcpProject: S, groupId: S, window: S, limit: N }, ['groupId'])),
  ];
}

type GcpSignalKind = 'monitoring' | 'logging' | 'trace' | 'errors';

export const SIGNAL_OF: Record<string, GcpSignalKind> = {
  query_metrics: 'monitoring', list_metric_descriptors: 'monitoring', error_rate_summary: 'monitoring', latency_summary: 'monitoring',
  query_logs: 'logging', log_error_summary: 'logging',
  list_traces: 'trace', get_trace: 'trace',
  list_error_groups: 'errors', get_error_group: 'errors',
};

/** Offer tools only when the project has a connection; gate each by its connection signal. */
export function filterGcpToolDefs(defs: ToolDef[], ctx: { hasConnection: boolean; signals: Set<GcpSignalKind> }): ToolDef[] {
  if (!ctx.hasConnection) return [];
  return defs.filter((d) => {
    const bare = d.name.replace('integration.gcp.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

export async function callGcpTool(ctx: GcpToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.gcp.', '');

  const binding = await getGcpProjectConnection(ctx.db, ctx.projectId);
  if (!binding) return { content: 'no GCP connection configured for this project', isError: true };

  let creds: GcpCreds;
  let defaultGcpProject: string | undefined;
  try {
    const conn = await getGcpConnection(ctx.db, ctx.orgId, binding.connectionId);
    if (!conn) return { content: 'GCP connection not found', isError: true };
    creds = credsForConnection(conn, ctx.config);
    defaultGcpProject = (conn.metadata as { defaultGcpProjectId?: string })?.defaultGcpProjectId;
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }

  const targets = await listGcpTargets(ctx.db, ctx.projectId);
  const allowed: GcpAllowed = { allowed: new Set(targets.map((t) => t.gcpProjectId)), unrestricted: targets.length === 0 };

  if (bare === 'list_scope') {
    return { content: JSON.stringify({
      connectionDefaultProject: defaultGcpProject ?? null,
      unrestricted: allowed.unrestricted,
      projects: targets.map((t) => ({ gcpProjectId: t.gcpProjectId, label: t.label })),
    }) };
  }
  if (bare === 'describe_datasets') return { content: GCP_DATASETS_REFERENCE };

  const resolveProject = (): string | { error: string } => {
    let gp: string | undefined = args.gcpProject;
    if (!gp) {
      if (allowed.unrestricted) return { error: 'gcpProject is required when scope is unrestricted' };
      if (targets.length === 1) gp = targets[0]!.gcpProjectId;
      else return { error: 'gcpProject is required (multiple projects in scope)' };
    }
    const v = validateGcpScope(gp, allowed);
    if (!v.ok) return { error: v.error };
    return gp;
  };

  const win = { window: args.window, start: args.start, end: args.end };
  const client = ctx.client ?? realGcpClient;

  // Error Reporting needs the broad cloud-platform scope; everything else stays narrow.
  const scopes = SIGNAL_OF[bare] === 'errors' ? GCP_ERRORREPORTING_SCOPES : GCP_READONLY_SCOPES;
  let token: string;
  try {
    token = await mintToken(creds, scopes);
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }

  try {
    switch (bare) {
      case 'query_metrics': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        if (!args.query) return { content: 'query is required', isError: true };
        return { content: JSON.stringify(await client.queryMetrics(token, gp, { query: String(args.query), ...win, step: args.step })) };
      }
      case 'query_logs': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        if (!args.filter) return { content: 'filter is required', isError: true };
        return { content: JSON.stringify(await client.queryLogs(token, gp, { filter: String(args.filter), ...win, limit: args.limit, order: args.order as 'asc' | 'desc' | undefined })) };
      }
      case 'list_traces': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        return { content: JSON.stringify(await client.listTraces(token, gp, { filter: args.filter, ...win, limit: args.limit })) };
      }
      case 'get_trace': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        if (!args.traceId) return { content: 'traceId is required', isError: true };
        return { content: JSON.stringify(await client.getTrace(token, gp, String(args.traceId))) };
      }
      case 'list_metric_descriptors': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        return { content: JSON.stringify(await client.listMetricDescriptors(token, gp, { prefix: args.prefix })) };
      }
      case 'error_rate_summary': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        return { content: JSON.stringify(await client.queryMetrics(token, gp, { query: errorRatePromQL(), ...win })) };
      }
      case 'latency_summary': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        const out: Record<string, unknown> = {};
        for (const q of [0.5, 0.95, 0.99]) out[`p${Math.round(q * 100)}`] = await client.queryMetrics(token, gp, { query: latencyPromQL(q), ...win });
        return { content: JSON.stringify(out) };
      }
      case 'log_error_summary': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        return { content: JSON.stringify(await client.queryLogs(token, gp, { filter: logErrorFilter(), ...win, limit: args.limit ?? 50, order: 'desc' })) };
      }
      case 'list_error_groups': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        return { content: JSON.stringify(await client.listErrorGroups(token, gp, { ...win, limit: args.limit })) };
      }
      case 'get_error_group': {
        const gp = resolveProject(); if (typeof gp !== 'string') return { content: gp.error, isError: true };
        if (!args.groupId) return { content: 'groupId is required', isError: true };
        return { content: JSON.stringify(await client.getErrorGroup(token, gp, { groupId: String(args.groupId), ...win, limit: args.limit })) };
      }
      default:
        return { content: `unknown gcp tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
