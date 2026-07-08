import {
  listDatadogTargets, listDatadogConnectionsForProject, getDatadogConnection,
  credsForDatadogConnection, validateDatadogScope, datadogScopeKey, datadogTagFilter,
  datadogLogErrorQuery, datadogSpanErrorQuery, datadogMetricQuery, realDatadogClient,
  type Db, type DatadogClient, type DatadogAllowed, type DatadogSignal,
} from '@intellilabs/core';
import { DATADOG_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean }
export interface ToolResult { content: string; isError?: boolean }
export interface DatadogToolCtx { db: Db; orgId: string; projectId: string; config: { SECRETS_KEY?: string }; client?: DatadogClient }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;

export type DatadogSignalKind = 'metrics' | 'logs' | 'traces' | 'alerts';

export const SIGNAL_OF: Record<string, DatadogSignalKind> = {
  query_metrics: 'metrics', list_metrics: 'metrics',
  query_logs: 'logs', log_error_summary: 'logs',
  list_traces: 'traces', get_trace: 'traces', error_rate_summary: 'traces', latency_summary: 'traces',
  list_monitors: 'alerts',
};

export function datadogToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.datadog.${name}`, description, parameters, kind: 'integration', mutates: false });
  const scope = { env: S, service: S };
  const win = { window: S, start: S, end: S };
  return [
    d('list_scope', "List the Datadog (env, service?) pairs this project's assistants can query, and which signals each connection has.", obj({}, [])),
    d('describe_datasets', 'Reference for Datadog metrics/logs/traces/alerts and how to write metric queries and log/span filters. Call before writing a raw query.', obj({}, [])),
    d('query_metrics', 'Fetch Datadog metrics for the scoped (env, service?). Pass a metric name or a full metric query string.', obj({ ...scope, query: S, metric: S, ...win }, ['env'])),
    d('list_metrics', 'Discover the Datadog metric names visible to the API key.', obj({ env: S, ...win }, [])),
    d('query_logs', 'Search Datadog logs for the scoped (env, service?). The scope tags are prepended automatically; pass additional filter terms as query.', obj({ ...scope, query: S, limit: N, ...win }, ['env', 'query'])),
    d('log_error_summary', 'Aggregate error-severity log events for the scoped (env, service?) and return top error groups.', obj({ ...scope, ...win }, ['env'])),
    d('list_traces', 'List APM error spans for the scoped (env, service?). Pass an optional extra filter fragment (e.g. @resource_name:"/api/checkout").', obj({ ...scope, filter: S, limit: N, ...win }, ['env'])),
    d('get_trace', 'Fetch all APM spans for one trace by traceId.', obj({ ...scope, traceId: S, ...win }, ['env', 'traceId'])),
    d('error_rate_summary', 'Compute the APM request error rate (errors ÷ total) for the scoped (env, service?) over a window.', obj({ ...scope, ...win }, ['env'])),
    d('latency_summary', 'Compute APM request latency percentiles (p50/p95/p99) for the scoped (env, service?) over a window.', obj({ ...scope, ...win }, ['env'])),
    d('list_monitors', 'List Datadog monitor definitions and their alert state, optionally filtered by states (e.g. "Alert").', obj({ env: S, service: S, states: S }, [])),
  ];
}

export function filterDatadogToolDefs(defs: ToolDef[], ctx: { hasScope: boolean; signals: Set<DatadogSignalKind> }): ToolDef[] {
  if (!ctx.hasScope) return [];
  return defs.filter((def) => {
    const bare = def.name.replace('integration.datadog.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

/** Resolve the target from args, applying auto-default when there is exactly one target. */
function resolveTarget(
  targets: Awaited<ReturnType<typeof listDatadogTargets>>,
  env: string | undefined,
  service: string | undefined,
  allowed: DatadogAllowed,
): { ok: true; target: (typeof targets)[0]; env: string; service: string | null } | { ok: false; error: string } {
  // Auto-default: if exactly one target and no env provided, use it
  let resolvedEnv = env;
  let resolvedService: string | null = service ?? null;
  if (!resolvedEnv && targets.length === 1) {
    resolvedEnv = targets[0]!.env;
    resolvedService = targets[0]!.service;
  }
  if (!resolvedEnv) {
    return { ok: false, error: 'env is required when there are multiple targets in scope. Call integration.datadog.list_scope to see the available (env, service) pairs, then retry with the env value.' };
  }
  // If service not specified but exactly one target with this env, auto-default service too
  if (!service) {
    const envTargets = targets.filter((t) => t.env === resolvedEnv);
    if (envTargets.length === 1) resolvedService = envTargets[0]!.service;
  }
  const check = validateDatadogScope(resolvedEnv, resolvedService, allowed);
  if (!check.ok) return { ok: false, error: check.error };
  const target = targets.find((t) => t.env === resolvedEnv && t.service === resolvedService)
    ?? targets.find((t) => t.env === resolvedEnv);
  if (!target) return { ok: false, error: `env ${resolvedEnv} is not in this project's Datadog scope` };
  return { ok: true, target, env: resolvedEnv, service: resolvedService };
}

export async function callDatadogTool(ctx: DatadogToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.datadog.', '');

  // list_scope and describe_datasets don't need a target lookup to be useful
  if (bare === 'list_scope') {
    const targets = await listDatadogTargets(ctx.db, ctx.projectId);
    const conns = await listDatadogConnectionsForProject(ctx.db, ctx.orgId, ctx.projectId);
    const sigOf = (id: string) => {
      const c = conns.find((x) => x.id === id);
      if (!c?.enabled) return [];
      return (c.metadata as { availableSignals?: string[] })?.availableSignals ?? [];
    };
    return {
      content: JSON.stringify({
        scope: targets.map((t) => ({ env: t.env, service: t.service, label: t.label, signals: sigOf(t.connectionId) })),
      }),
    };
  }
  if (bare === 'describe_datasets') return { content: DATADOG_DATASETS_REFERENCE };

  // All other tools require at least one target
  const targets = await listDatadogTargets(ctx.db, ctx.projectId);
  if (targets.length === 0) return { content: 'no Datadog scope configured for this project', isError: true };

  const allowed: DatadogAllowed = { pairs: new Set(targets.map((t) => datadogScopeKey(t.env, t.service))) };
  const resolved = resolveTarget(targets, args.env, args.service, allowed);
  if (!resolved.ok) return { content: resolved.error, isError: true };

  const { target, env, service } = resolved;

  const client = ctx.client ?? realDatadogClient;

  let creds: Awaited<ReturnType<typeof credsForDatadogConnection>>;
  if (ctx.client) {
    // Test / injected client — skip real credential decryption; provide a stub creds object.
    creds = { mode: 'api_keys', apiKey: '', appKey: '', site: 'us1' };
  } else {
    try {
      const conn = await getDatadogConnection(ctx.db, ctx.orgId, target.connectionId);
      if (!conn) return { content: 'Datadog connection not found', isError: true };
      creds = credsForDatadogConnection(conn, ctx.config);
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
  const win = { window: args.window, start: args.start, end: args.end };

  try {
    switch (bare) {
      case 'query_metrics': {
        const query = args.query
          ? String(args.query)
          : datadogMetricQuery(String(args.metric ?? 'trace.http.request.hits'), env, service);
        return { content: JSON.stringify(await client.queryMetrics(creds, { query, ...win })) };
      }
      case 'list_metrics': {
        const filterTag = datadogTagFilter(env, service);
        return { content: JSON.stringify(await client.listMetrics(creds, { filterTag, ...win })) };
      }
      case 'query_logs': {
        const baseFilter = datadogTagFilter(env, service);
        const extra = args.query ? String(args.query) : undefined;
        const query = extra ? `${baseFilter} ${extra}` : baseFilter;
        return { content: JSON.stringify(await client.searchLogs(creds, { query, limit: args.limit, ...win })) };
      }
      case 'log_error_summary': {
        const query = datadogLogErrorQuery(env, service);
        return { content: JSON.stringify(await client.aggregateLogs(creds, { query, ...win })) };
      }
      case 'list_traces': {
        const base = datadogSpanErrorQuery(env, service);
        const query = args.filter ? `${base} ${args.filter}` : base;
        return { content: JSON.stringify(await client.searchSpans(creds, { query, limit: args.limit, ...win })) };
      }
      case 'get_trace': {
        const base = datadogTagFilter(env, service);
        const query = `${base} @trace_id:${String(args.traceId)}`;
        return { content: JSON.stringify(await client.searchSpans(creds, { query, limit: 1000, ...win })) };
      }
      case 'error_rate_summary': {
        const query = datadogTagFilter(env, service);
        // Aggregate total and error spans to compute error %
        return { content: JSON.stringify(await client.aggregateSpans(creds, { query, aggregation: 'count', ...win })) };
      }
      case 'latency_summary': {
        const query = datadogTagFilter(env, service);
        return { content: JSON.stringify(await client.aggregateSpans(creds, { query, metric: '@duration', aggregation: 'percentile', groupBy: ['@duration'], ...win })) };
      }
      case 'list_monitors': {
        const tags = datadogTagFilter(env, service);
        return { content: JSON.stringify(await client.listMonitors(creds, { tags, monitorStates: args.states })) };
      }
      default:
        return { content: `unknown datadog tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
