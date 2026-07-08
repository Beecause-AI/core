import {
  listAwsTargets, listAwsConnectionsForProject, getAwsConnection,
  credsForAwsConnection, resolveAwsCreds, validateAwsScope, awsScopeKey,
  latencyStatistics, logErrorQuery, realAwsClient,
  type Db, type AwsClient, type AwsCreds, type AwsAllowed, type AwsAuthConfig,
} from '@intellilabs/core';
import { AWS_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean }
export interface ToolResult { content: string; isError?: boolean }
export interface AwsToolCtx { db: Db; orgId: string; projectId: string; config: AwsAuthConfig; client?: AwsClient }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const A = { type: 'array' } as const;

export type AwsSignalKind = 'metrics' | 'logs' | 'traces' | 'alarms';

export const SIGNAL_OF: Record<string, AwsSignalKind> = {
  query_metrics: 'metrics', list_metrics: 'metrics', error_rate_summary: 'metrics', latency_summary: 'metrics',
  query_logs: 'logs', list_log_groups: 'logs', log_error_summary: 'logs',
  list_traces: 'traces', get_trace: 'traces',
  list_alarms: 'alarms',
};

export function awsToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.aws.${name}`, description, parameters, kind: 'integration', mutates: false });
  const scope = { account: S, region: S };
  const win = { window: S, start: S, end: S };
  const dims = { type: 'array', items: obj({ name: S, value: S }, ['name', 'value']) };
  return [
    d('list_scope', "List the AWS account/region pairs this project's assistants can query, and which signals each has.", obj({}, [])),
    d('describe_datasets', 'Reference for AWS metrics/logs/traces/alarms and how to write query_metrics / query_logs / X-Ray filters. Call before writing a raw query.', obj({}, [])),
    d('query_metrics', 'Fetch a CloudWatch metric. Provide namespace + metricName + dimensions + stat (Average/Sum/Min/Max/SampleCount) + period seconds, bounded by window OR start/end. account+region must be in scope.', obj({ ...scope, namespace: S, metricName: S, dimensions: dims, stat: S, period: N, ...win }, ['namespace', 'metricName'])),
    d('list_metrics', 'Discover CloudWatch metric names + dimensions in a namespace. account+region must be in scope.', obj({ ...scope, namespace: S, metricName: S }, [])),
    d('error_rate_summary', 'Error-rate percentage over a window for a namespace (errors ÷ total). account+region must be in scope.', obj({ ...scope, namespace: S, errorMetric: S, totalMetric: S, dimensions: dims, ...win }, ['namespace', 'errorMetric', 'totalMetric'])),
    d('latency_summary', 'Latency p50/p95/p99 for a metric over a window. account+region must be in scope.', obj({ ...scope, namespace: S, metricName: S, dimensions: dims, ...win }, ['namespace', 'metricName'])),
    d('query_logs', 'Run a CloudWatch Logs Insights query over one or more log groups. account+region must be in scope.', obj({ ...scope, logGroupNames: A, query: S, limit: N, ...win }, ['logGroupNames', 'query'])),
    d('list_log_groups', 'List CloudWatch log groups (optional name prefix). account+region must be in scope.', obj({ ...scope, prefix: S, limit: N }, [])),
    d('log_error_summary', 'Sample of error-like log entries over a window for the given log groups. account+region must be in scope.', obj({ ...scope, logGroupNames: A, limit: N, ...win }, ['logGroupNames'])),
    d('list_traces', 'List X-Ray trace summaries matching an optional filter expression over a window. account+region must be in scope.', obj({ ...scope, filter: S, ...win }, [])),
    d('get_trace', 'Fetch full X-Ray traces by id (from list_traces). account+region must be in scope.', obj({ ...scope, traceIds: A }, ['traceIds'])),
    d('list_alarms', 'List CloudWatch alarms and their state (pass stateValue "ALARM" for firing only). account+region must be in scope.', obj({ ...scope, stateValue: S, prefix: S, limit: N }, [])),
  ];
}

export function filterAwsToolDefs(defs: ToolDef[], ctx: { hasScope: boolean; signals: Set<AwsSignalKind> }): ToolDef[] {
  if (!ctx.hasScope) return [];
  return defs.filter((def) => {
    const bare = def.name.replace('integration.aws.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

export async function callAwsTool(ctx: AwsToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.aws.', '');

  const targets = await listAwsTargets(ctx.db, ctx.projectId);
  if (targets.length === 0) return { content: 'no AWS scope configured for this project', isError: true };

  if (bare === 'list_scope') {
    // Resolve each target's connection so we can report its verified signals.
    const conns = await listAwsConnectionsForProject(ctx.db, ctx.orgId, ctx.projectId);
    const sigOf = (id: string) => ((conns.find((c) => c.id === id)?.metadata as { availableSignals?: string[] })?.availableSignals ?? []);
    return { content: JSON.stringify({
      scope: targets.map((t) => ({ account: t.awsAccountId, region: t.awsRegion, label: t.label, signals: sigOf(t.connectionId) })),
    }) };
  }
  if (bare === 'describe_datasets') return { content: AWS_DATASETS_REFERENCE };

  // Resolve (account, region) against scope; default to the only target if unambiguous.
  const allowed: AwsAllowed = { pairs: new Set(targets.map((t) => awsScopeKey(t.awsAccountId, t.awsRegion))) };
  let account: string | undefined = args.account;
  let region: string | undefined = args.region;
  if ((!account || !region) && targets.length === 1) { account = targets[0]!.awsAccountId; region = targets[0]!.awsRegion; }
  if (!account || !region) return { content: 'account and region are required (multiple in scope — see list_scope)', isError: true };
  const scopeCheck = validateAwsScope(account, region, allowed);
  if (!scopeCheck.ok) return { content: scopeCheck.error, isError: true };

  const target = targets.find((t) => t.awsAccountId === account && t.awsRegion === region)!;
  let creds: AwsCreds;
  try {
    const conn = await getAwsConnection(ctx.db, ctx.orgId, target.connectionId);
    if (!conn) return { content: 'AWS connection not found', isError: true };
    creds = credsForAwsConnection(conn, ctx.config);
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }

  const client = ctx.client ?? realAwsClient;
  const win = { window: args.window, start: args.start, end: args.end };
  try {
    const resolved = await resolveAwsCreds(creds, region, ctx.config);
    switch (bare) {
      case 'query_metrics':
        return { content: JSON.stringify(await client.queryMetrics(resolved, region, { namespace: String(args.namespace), metricName: String(args.metricName), dimensions: args.dimensions, stat: args.stat, period: args.period, ...win })) };
      case 'list_metrics':
        return { content: JSON.stringify(await client.listMetrics(resolved, region, { namespace: args.namespace, metricName: args.metricName })) };
      case 'latency_summary': {
        const out: Record<string, unknown> = {};
        for (const stat of latencyStatistics()) out[stat] = await client.queryMetrics(resolved, region, { namespace: String(args.namespace), metricName: String(args.metricName), dimensions: args.dimensions, extendedStatistic: stat, ...win });
        return { content: JSON.stringify(out) };
      }
      case 'error_rate_summary': {
        const errs = await client.queryMetrics(resolved, region, { namespace: String(args.namespace), metricName: String(args.errorMetric), dimensions: args.dimensions, stat: 'Sum', ...win });
        const total = await client.queryMetrics(resolved, region, { namespace: String(args.namespace), metricName: String(args.totalMetric), dimensions: args.dimensions, stat: 'Sum', ...win });
        return { content: JSON.stringify({ errors: errs, total }) };
      }
      case 'query_logs':
        return { content: JSON.stringify(await client.queryLogs(resolved, region, { logGroupNames: args.logGroupNames, query: String(args.query), limit: args.limit, ...win })) };
      case 'list_log_groups':
        return { content: JSON.stringify(await client.listLogGroups(resolved, region, { prefix: args.prefix, limit: args.limit })) };
      case 'log_error_summary':
        return { content: JSON.stringify(await client.queryLogs(resolved, region, { logGroupNames: args.logGroupNames, query: logErrorQuery(), limit: args.limit ?? 50, ...win })) };
      case 'list_traces':
        return { content: JSON.stringify(await client.listTraces(resolved, region, { filter: args.filter, ...win })) };
      case 'get_trace':
        return { content: JSON.stringify(await client.getTrace(resolved, region, { traceIds: args.traceIds })) };
      case 'list_alarms':
        return { content: JSON.stringify(await client.listAlarms(resolved, region, { stateValue: args.stateValue, prefix: args.prefix, limit: args.limit })) };
      default:
        return { content: `unknown aws tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
