import {
  getGrafanaProjectConnection, getGrafanaConnection, listGrafanaTargets,
  grafanaCredsForConnection, grafanaAuthHeaders, grafanaSignalForType,
  grafanaErrorRatePromQL, grafanaLatencyPromQL, grafanaLogErrorLogQL, realGrafanaClient,
  type Db, type GrafanaClient, type GrafanaSignal, type GrafanaDatasourceRef,
} from '@intellilabs/core';
import { GRAFANA_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean; }
export interface ToolResult { content: string; isError?: boolean; }
export interface GrafanaToolCtx { db: Db; orgId: string; projectId: string; config: { SECRETS_KEY?: string }; client?: GrafanaClient; }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;

export function grafanaToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.grafana.${name}`, description, parameters, kind: 'integration', mutates: false });
  const dsWin = obj({ datasourceUid: S, window: S, start: S, end: S }, []);
  return [
    d('list_scope', "List what this project's assistants can query: the bound Grafana connection and the allowed datasources (uid/type/name), or 'unrestricted' = any datasource the connection's token can reach.", obj({}, [])),
    d('describe_datasets', 'Reference for Grafana metrics/logs/traces datasets and how to write PromQL / LogQL / TraceQL. Call before writing a raw query.', obj({}, [])),
    d('query_metrics', 'Run a PromQL query against a Prometheus datasource via Grafana. Omit step for an instant query; pass step (e.g. "60s") for a range query. Bound time with window OR explicit start/end ISO timestamps. `datasourceUid` selects the datasource (optional when one metrics datasource is in scope).', obj({ datasourceUid: S, query: S, window: S, start: S, end: S, step: S }, ['query'])),
    d('query_logs', 'Run a LogQL query against a Loki datasource via Grafana. The query needs a stream selector, e.g. {app="api"} |= "error". `datasourceUid` selects the datasource (optional when one logs datasource is in scope).', obj({ datasourceUid: S, query: S, window: S, start: S, end: S, limit: N, direction: S }, ['query'])),
    d('list_traces', 'Search a Tempo datasource via Grafana with an optional TraceQL query (e.g. "{ status = error }"). `datasourceUid` selects the datasource (optional when one traces datasource is in scope).', obj({ datasourceUid: S, query: S, window: S, start: S, end: S, limit: N }, [])),
    d('get_trace', 'Fetch one trace and its spans by traceId from a Tempo datasource. `datasourceUid` selects the datasource (optional when one traces datasource is in scope).', obj({ datasourceUid: S, traceId: S }, ['traceId'])),
    d('error_rate_summary', 'Request 5xx error-rate ratio over a window (PromQL recipe, common metric names). Prefer over raw query_metrics for a quick RCA signal.', dsWin),
    d('latency_summary', 'Request latency p50/p95/p99 over a window (PromQL recipe, common metric names).', dsWin),
    d('log_error_summary', 'Recent error/exception/fatal log lines over a window (LogQL recipe).', obj({ datasourceUid: S, window: S, start: S, end: S, limit: N }, [])),
  ];
}

export const SIGNAL_OF: Record<string, GrafanaSignal> = {
  query_metrics: 'metrics', error_rate_summary: 'metrics', latency_summary: 'metrics',
  query_logs: 'logs', log_error_summary: 'logs',
  list_traces: 'traces', get_trace: 'traces',
};

/** Offer tools only when the project has a connection; gate each query tool by its signal. */
export function filterGrafanaToolDefs(defs: ToolDef[], ctx: { hasConnection: boolean; signals: Set<GrafanaSignal> }): ToolDef[] {
  if (!ctx.hasConnection) return [];
  return defs.filter((d) => {
    const bare = d.name.replace('integration.grafana.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

export async function callGrafanaTool(ctx: GrafanaToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.grafana.', '');

  const binding = await getGrafanaProjectConnection(ctx.db, ctx.projectId);
  if (!binding) return { content: 'no Grafana connection configured for this project', isError: true };

  let headers: Record<string, string>;
  let baseUrl: string;
  let connDatasources: GrafanaDatasourceRef[];
  try {
    const conn = await getGrafanaConnection(ctx.db, ctx.orgId, binding.connectionId);
    if (!conn) return { content: 'Grafana connection not found', isError: true };
    headers = grafanaAuthHeaders(grafanaCredsForConnection(conn, ctx.config));
    baseUrl = conn.baseUrl;
    connDatasources = (conn.metadata as { datasources?: GrafanaDatasourceRef[] })?.datasources ?? [];
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }

  const targets = await listGrafanaTargets(ctx.db, ctx.projectId);
  const unrestricted = targets.length === 0;
  // The pool of datasources we may pick from: the scope when restricted, else everything the connection saw.
  const pool: GrafanaDatasourceRef[] = unrestricted
    ? connDatasources
    : targets.map((t) => ({ uid: t.datasourceUid, name: t.name, type: t.datasourceType }));
  const allowedUids = new Set(targets.map((t) => t.datasourceUid));

  const client = ctx.client ?? realGrafanaClient;

  if (bare === 'list_scope') {
    return { content: JSON.stringify({
      unrestricted,
      datasources: pool.map((d) => ({ uid: d.uid, type: d.type, name: d.name })),
    }) };
  }
  if (bare === 'describe_datasets') return { content: GRAFANA_DATASETS_REFERENCE };

  // Resolve which datasource to query for a given signal, enforcing scope.
  const resolveUid = (signal: GrafanaSignal): string | { error: string } => {
    const provided: string | undefined = args.datasourceUid;
    if (provided) {
      if (!unrestricted && !allowedUids.has(provided)) return { error: `datasource ${provided} is not in this project's scope` };
      return provided;
    }
    const candidates = pool.filter((d) => grafanaSignalForType(d.type) === signal);
    if (candidates.length === 1) return candidates[0]!.uid;
    if (candidates.length === 0) return { error: `no ${signal} datasource in scope — specify datasourceUid` };
    return { error: `datasourceUid is required (multiple ${signal} datasources in scope: ${candidates.map((c) => c.uid).join(', ')})` };
  };

  const win = { window: args.window, start: args.start, end: args.end };

  try {
    switch (bare) {
      case 'query_metrics': {
        const uid = resolveUid('metrics'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        if (!args.query) return { content: 'query is required', isError: true };
        return { content: JSON.stringify(await client.queryMetrics(baseUrl, headers, uid, { query: String(args.query), ...win, step: args.step })) };
      }
      case 'query_logs': {
        const uid = resolveUid('logs'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        if (!args.query) return { content: 'query is required', isError: true };
        return { content: JSON.stringify(await client.queryLogs(baseUrl, headers, uid, { query: String(args.query), ...win, limit: args.limit, direction: args.direction as 'forward' | 'backward' | undefined })) };
      }
      case 'list_traces': {
        const uid = resolveUid('traces'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        return { content: JSON.stringify(await client.searchTraces(baseUrl, headers, uid, { query: args.query, ...win, limit: args.limit })) };
      }
      case 'get_trace': {
        const uid = resolveUid('traces'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        if (!args.traceId) return { content: 'traceId is required', isError: true };
        return { content: JSON.stringify(await client.getTrace(baseUrl, headers, uid, String(args.traceId))) };
      }
      case 'error_rate_summary': {
        const uid = resolveUid('metrics'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        return { content: JSON.stringify(await client.queryMetrics(baseUrl, headers, uid, { query: grafanaErrorRatePromQL(), ...win })) };
      }
      case 'latency_summary': {
        const uid = resolveUid('metrics'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        const out: Record<string, unknown> = {};
        for (const q of [0.5, 0.95, 0.99]) out[`p${Math.round(q * 100)}`] = await client.queryMetrics(baseUrl, headers, uid, { query: grafanaLatencyPromQL(q), ...win });
        return { content: JSON.stringify(out) };
      }
      case 'log_error_summary': {
        const uid = resolveUid('logs'); if (typeof uid !== 'string') return { content: uid.error, isError: true };
        return { content: JSON.stringify(await client.queryLogs(baseUrl, headers, uid, { query: grafanaLogErrorLogQL(), ...win, limit: args.limit ?? 100, direction: 'backward' })) };
      }
      default:
        return { content: `unknown grafana tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
