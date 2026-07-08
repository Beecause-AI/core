import {
  listDynatraceTargets, listDynatraceConnectionsForProject, getDynatraceConnection,
  credsForDynatraceConnection, validateDynatraceScope, dynatraceScopeKey, dynatraceEntitySelector,
  dynatraceLogErrorQuery, dynatraceMetricSelector, SERVICE_LATENCY_METRIC, SERVICE_ERROR_RATE_METRIC,
  realDynatraceClient,
  type Db, type DynatraceClient, type DynatraceAllowed, type DynatraceSignal,
} from '@intellilabs/core';
import { DYNATRACE_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean }
export interface ToolResult { content: string; isError?: boolean }
export interface DynatraceToolCtx { db: Db; orgId: string; projectId: string; config: { SECRETS_KEY?: string }; client?: DynatraceClient }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;

export type DynatraceSignalKind = 'metrics' | 'logs' | 'problems';

export const SIGNAL_OF: Record<string, DynatraceSignalKind> = {
  query_metrics: 'metrics', list_metrics: 'metrics', error_rate_summary: 'metrics', latency_summary: 'metrics',
  query_logs: 'logs', log_error_summary: 'logs',
  list_problems: 'problems', get_problem: 'problems',
};

export function dynatraceToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.dynatrace.${name}`, description, parameters, kind: 'integration', mutates: false });
  const scope = { managementZone: S, service: S };
  const win = { window: S, start: S, end: S };
  return [
    d('list_scope', "List the Dynatrace (managementZone, service?) targets this project's assistants can query, and which signals each connection has.", obj({}, [])),
    d('describe_datasets', 'Reference for Dynatrace metrics/logs/problems and how to write metric selectors and log/problem filters. Call before writing a raw query.', obj({}, [])),
    d('query_metrics', 'Fetch Dynatrace metrics for the scoped (managementZone, service?). Pass a metricSelector (e.g. builtin:service.response.time:avg).', obj({ ...scope, metricSelector: S, ...win }, ['metricSelector'])),
    d('list_metrics', 'Discover Dynatrace metric keys visible to the API token.', obj({ ...scope, text: S }, [])),
    d('query_logs', 'Search Dynatrace logs for the scoped (managementZone, service?). The scope is applied automatically; pass additional filter terms as query.', obj({ ...scope, query: S, limit: N, ...win }, ['query'])),
    d('log_error_summary', 'Aggregate error-severity log events for the scoped (managementZone, service?).', obj({ ...scope, ...win }, [])),
    d('error_rate_summary', 'Compute the service error rate (builtin:service.errors.total.rate) for the scoped (managementZone, service?) over a window.', obj({ ...scope, ...win }, [])),
    d('latency_summary', 'Compute service response-time latency (builtin:service.response.time) for the scoped (managementZone, service?) over a window.', obj({ ...scope, ...win }, [])),
    d('list_problems', 'List Dynatrace Davis problems for the scoped (managementZone, service?), optionally filtered (e.g. status("OPEN")).', obj({ ...scope, problemSelector: S, ...win }, [])),
    d('get_problem', 'Fetch one Dynatrace problem by problemId, with root-cause and affected entities.', obj({ problemId: S }, ['problemId'])),
  ];
}

export function filterDynatraceToolDefs(defs: ToolDef[], ctx: { hasScope: boolean; signals: Set<DynatraceSignalKind> }): ToolDef[] {
  if (!ctx.hasScope) return [];
  return defs.filter((def) => {
    const bare = def.name.replace('integration.dynatrace.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

/** Scope AND helper for query_logs: prepends management zone + service scope filters onto the user query. */
function scopeAnd(managementZone: string | null, service: string | null, q: string): string {
  const parts = [q];
  if (managementZone) parts.push(`dt.management_zone.name=="${managementZone}"`);
  if (service) parts.push(`dt.entity.service.name=="${service}"`);
  return parts.filter(Boolean).join(' AND ');
}

/** Resolve the target from args, applying auto-default when there is exactly one target. */
function resolveTarget(
  targets: Awaited<ReturnType<typeof listDynatraceTargets>>,
  managementZone: string | undefined,
  service: string | undefined,
  allowed: DynatraceAllowed,
): { ok: true; target: (typeof targets)[0]; managementZone: string | null; service: string | null } | { ok: false; error: string } {
  let mz: string | null = managementZone ?? null;
  let svc: string | null = service ?? null;
  if (!managementZone && !service && targets.length === 1) {
    mz = targets[0]!.managementZone; svc = targets[0]!.service;
  }
  if (!mz && !svc) {
    return { ok: false, error: 'managementZone or service is required when there are multiple targets in scope. Call integration.dynatrace.list_scope to see the available pairs, then retry.' };
  }
  const check = validateDynatraceScope(mz, svc, allowed);
  if (!check.ok) return { ok: false, error: check.error };
  const target = targets.find((t) => t.managementZone === mz && t.service === svc);
  if (!target) return { ok: false, error: `(managementZone=${mz ?? '*'}, service=${svc ?? '*'}) is not in this project's Dynatrace scope` };
  return { ok: true, target, managementZone: mz, service: svc };
}

export async function callDynatraceTool(ctx: DynatraceToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.dynatrace.', '');

  // list_scope and describe_datasets don't need a target lookup to be useful
  if (bare === 'list_scope') {
    const targets = await listDynatraceTargets(ctx.db, ctx.projectId);
    const conns = await listDynatraceConnectionsForProject(ctx.db, ctx.orgId, ctx.projectId);
    const sigOf = (id: string) => {
      const c = conns.find((x) => x.id === id);
      if (!c?.enabled) return [];
      return (c.metadata as { availableSignals?: string[] })?.availableSignals ?? [];
    };
    return {
      content: JSON.stringify({
        scope: targets.map((t) => ({ managementZone: t.managementZone, service: t.service, label: t.label, signals: sigOf(t.connectionId) })),
      }),
    };
  }
  if (bare === 'describe_datasets') return { content: DYNATRACE_DATASETS_REFERENCE };

  // All other tools require at least one target
  const targets = await listDynatraceTargets(ctx.db, ctx.projectId);
  if (targets.length === 0) return { content: 'no Dynatrace scope configured for this project', isError: true };

  const client = ctx.client ?? realDynatraceClient;

  // get_problem skips resolveTarget (problemId is global) but still requires targets to exist
  if (bare === 'get_problem') {
    let creds: Awaited<ReturnType<typeof credsForDynatraceConnection>>;
    if (ctx.client) {
      creds = { mode: 'api_token', environmentUrl: 'https://test', apiToken: '' };
    } else {
      try {
        // Use the first available target's connection for get_problem
        const target = targets[0]!;
        const conn = await getDynatraceConnection(ctx.db, ctx.orgId, target.connectionId);
        if (!conn) return { content: 'Dynatrace connection not found', isError: true };
        creds = credsForDynatraceConnection(conn, ctx.config);
      } catch (err) {
        return { content: err instanceof Error ? err.message : String(err), isError: true };
      }
    }
    try {
      return { content: JSON.stringify(await client.getProblem(creds, { problemId: String(args.problemId) })) };
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }

  // All signal tools: resolve target by (managementZone, service)
  const allowed: DynatraceAllowed = { pairs: new Set(targets.map((t) => dynatraceScopeKey(t.managementZone, t.service))) };
  const resolved = resolveTarget(targets, args.managementZone, args.service, allowed);
  if (!resolved.ok) return { content: resolved.error, isError: true };

  const { target, managementZone, service } = resolved;

  let creds: Awaited<ReturnType<typeof credsForDynatraceConnection>>;
  if (ctx.client) {
    // Test / injected client — skip real credential decryption; provide a stub creds object.
    creds = { mode: 'api_token', environmentUrl: 'https://test', apiToken: '' };
  } else {
    try {
      const conn = await getDynatraceConnection(ctx.db, ctx.orgId, target.connectionId);
      if (!conn) return { content: 'Dynatrace connection not found', isError: true };
      creds = credsForDynatraceConnection(conn, ctx.config);
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }

  const win = { window: args.window, start: args.start, end: args.end };
  const sel = dynatraceEntitySelector(managementZone, service);

  try {
    switch (bare) {
      case 'query_metrics':
        return { content: JSON.stringify(await client.queryMetrics(creds, { metricSelector: String(args.metricSelector), entitySelector: sel, ...win })) };
      case 'list_metrics':
        return { content: JSON.stringify(await client.listMetrics(creds, { text: args.text })) };
      case 'query_logs':
        return { content: JSON.stringify(await client.searchLogs(creds, { query: scopeAnd(managementZone, service, String(args.query)), limit: args.limit, ...win })) };
      case 'log_error_summary':
        return { content: JSON.stringify(await client.aggregateLogs(creds, { query: dynatraceLogErrorQuery(managementZone, service), ...win })) };
      case 'error_rate_summary':
        return { content: JSON.stringify(await client.queryMetrics(creds, { metricSelector: dynatraceMetricSelector(SERVICE_ERROR_RATE_METRIC), entitySelector: sel, ...win })) };
      case 'latency_summary':
        return { content: JSON.stringify(await client.queryMetrics(creds, { metricSelector: dynatraceMetricSelector(SERVICE_LATENCY_METRIC), entitySelector: sel, ...win })) };
      case 'list_problems':
        return { content: JSON.stringify(await client.listProblems(creds, { problemSelector: args.problemSelector, entitySelector: sel, ...win })) };
      default:
        return { content: `unknown dynatrace tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
