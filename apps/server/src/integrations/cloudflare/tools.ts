import {
  getProjectConnection, getConnection, listCloudflareTargets,
  cfCredsForConnection, cfAuthHeaders, realCloudflareClient, validateGraphqlScopes,
  httpErrorSummary, latencySummary, firewallEvents, workerErrors,
  type Db, type CloudflareClient, type CfScope, type CfAllowed,
} from '@intellilabs/core';
import { CLOUDFLARE_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean; }
export interface ToolResult { content: string; isError?: boolean; }
export interface CloudflareToolCtx {
  db: Db; orgId: string; projectId: string;
  config: { SECRETS_KEY?: string };
  client?: CloudflareClient;
}

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const O = { type: 'object' } as const;

export function cloudflareToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.cloudflare.${name}`, description, parameters, kind: 'integration', mutates: false });
  const zoneWin = obj({ zone: S, window: S, start: S, end: S }, ['zone']);
  return [
    d('list_scope', "List what this project's assistants can query: the Cloudflare account and the allowed zones/accounts (or 'unrestricted' = any zone/account the connection can access).", obj({}, [])),
    d('describe_datasets', 'Return a reference of the Cloudflare GraphQL datasets useful for RCA (names, dimensions, metrics, example queries). Call this before writing a query_graphql query.', obj({}, [])),
    d('query_graphql', 'Run a raw Cloudflare GraphQL Analytics query (metrics + sampled adaptive logs). You MUST scope it to viewer.zones(filter:{zoneTag}) and/or viewer.accounts(filter:{accountTag}); the allowed zones/accounts come from list_scope (any if unrestricted). The scope is validated. Use describe_datasets for dataset names and examples.', obj({ query: S, variables: O }, ['query'])),
    d('http_error_summary', 'HTTP status-code breakdown + top failing paths over a window (RCA). `zone` is a zoneTag in scope. Prefer this over raw GraphQL.', zoneWin),
    d('latency_summary', 'Origin/edge response-time percentiles over a window. `zone` is a zoneTag in scope.', zoneWin),
    d('firewall_events', 'WAF/firewall events grouped by action/source/rule over a window. `zone` is a zoneTag in scope.', zoneWin),
    d('worker_errors', "Worker invocation errors over a window. `account` is an accountTag in scope (defaults to the connection's account).", obj({ account: S, window: S, start: S, end: S }, [])),
    d('query_worker_logs', "Recent Workers Observability log events. `account` is an accountTag in scope (defaults to the connection's account). Bound the time range with window (e.g. \"15m\") or explicit start/end; cap rows with limit.", obj({ account: S, window: S, start: S, end: S, limit: { type: 'number' } }, [])),
  ];
}

/** Cloudflare tools are offered whenever the project has a connection binding. */
export function filterCloudflareToolDefs(defs: ToolDef[], hasConnection: boolean): ToolDef[] {
  return hasConnection ? defs : [];
}

export async function callCloudflareTool(ctx: CloudflareToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.cloudflare.', '');

  const binding = await getProjectConnection(ctx.db, ctx.projectId);
  if (!binding) return { content: 'no Cloudflare connection configured for this project', isError: true };

  let headers: Record<string, string>;
  let connAccountId: string | undefined;
  try {
    const conn = await getConnection(ctx.db, ctx.orgId, binding.connectionId);
    if (!conn) return { content: 'Cloudflare connection not found', isError: true };
    headers = cfAuthHeaders(cfCredsForConnection(conn, ctx.config));
    connAccountId = (conn.metadata as { accountId?: string })?.accountId;
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }

  const resources = await listCloudflareTargets(ctx.db, ctx.projectId);
  const allowed: CfAllowed = {
    zones: new Set(resources.filter((r) => r.kind === 'zone' && r.zoneId).map((r) => r.zoneId!)),
    accounts: new Set(resources.filter((r) => r.kind === 'account').map((r) => r.accountId)),
    unrestricted: resources.length === 0,
  };

  if (bare === 'list_scope') {
    return { content: JSON.stringify({
      account: connAccountId ?? null,
      unrestricted: allowed.unrestricted,
      resources: resources.map((r) => ({ kind: r.kind, name: r.name, accountId: r.accountId, zoneId: r.zoneId })),
    }) };
  }
  if (bare === 'describe_datasets') {
    return { content: CLOUDFLARE_DATASETS_REFERENCE };
  }

  const checkZone = (zone: string): ToolResult | null =>
    !allowed.unrestricted && !allowed.zones.has(zone) ? { content: `zone ${zone} is not in this project's scope`, isError: true } : null;
  const checkAccount = (acct: string): ToolResult | null =>
    !allowed.unrestricted && !allowed.accounts.has(acct) ? { content: `account ${acct} is not in this project's scope`, isError: true } : null;

  const win = { window: args.window, start: args.start, end: args.end };
  const client = ctx.client ?? realCloudflareClient;

  try {
    switch (bare) {
      case 'query_graphql': {
        if (!args.query) return { content: 'query is required', isError: true };
        const v = validateGraphqlScopes(String(args.query), allowed);
        if (!v.ok) return { content: `query rejected: ${v.error}`, isError: true };
        return { content: JSON.stringify(await client.queryGraphql(headers, String(args.query), args.variables)) };
      }
      case 'http_error_summary':
      case 'latency_summary':
      case 'firewall_events': {
        const zone = String(args.zone ?? '');
        if (!zone) return { content: 'zone is required', isError: true };
        const err = checkZone(zone);
        if (err) return err;
        const scope: CfScope = { kind: 'zone', zoneTag: zone };
        const builder = bare === 'http_error_summary' ? httpErrorSummary : bare === 'latency_summary' ? latencySummary : firewallEvents;
        return { content: JSON.stringify(await client.queryGraphql(headers, builder(scope, win))) };
      }
      case 'worker_errors': {
        const account = args.account || connAccountId;
        if (!account) return { content: 'account required (connection has no account id)', isError: true };
        const err = checkAccount(account);
        if (err) return err;
        return { content: JSON.stringify(await client.queryGraphql(headers, workerErrors({ kind: 'account', accountTag: account }, win))) };
      }
      case 'query_worker_logs': {
        const account = args.account || connAccountId;
        if (!account) return { content: 'account required (connection has no account id)', isError: true };
        const err = checkAccount(account);
        if (err) return err;
        return { content: JSON.stringify(await client.queryWorkerLogs(headers, account, { ...win, limit: args.limit })) };
      }
      default:
        return { content: `unknown cloudflare tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
