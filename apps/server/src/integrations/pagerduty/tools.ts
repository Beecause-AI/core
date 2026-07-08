import {
  listPagerDutyTargets, listPagerDutyConnectionsForProject, getPagerDutyConnection,
  credsForPagerDutyConnection, targetsToPagerDutyFilter, defaultIncidentWindow, realPagerDutyClient,
  type Db, type PagerDutyClient, type PagerDutySignal,
} from '@intellilabs/core';
import { PAGERDUTY_DATASETS_REFERENCE } from './datasets.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean }
export interface ToolResult { content: string; isError?: boolean }
export interface PagerDutyToolCtx { db: Db; orgId: string; projectId: string; config: { SECRETS_KEY?: string }; client?: PagerDutyClient }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const SARR = { type: 'array', items: { type: 'string' } } as const;

export type PagerDutySignalKind = 'alerts';

export const SIGNAL_OF: Record<string, PagerDutySignalKind> = {
  list_services: 'alerts',
  list_incidents: 'alerts',
  get_incident: 'alerts',
  list_incident_alerts: 'alerts',
  list_incident_log_entries: 'alerts',
};

export function pagerdutyToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.pagerduty.${name}`, description, parameters, kind: 'integration', mutates: false });
  return [
    d('list_scope', "List the PagerDuty (team, service?) targets this project's assistants can query, and whether the connection has incidents access.", obj({}, [])),
    d('describe_datasets', 'Reference for the PagerDuty incident/alert model and how to filter list_incidents. Call before querying.', obj({}, [])),
    d('list_services', 'Discover PagerDuty services (id, name, status) in the account. Optional name query.', obj({ query: S }, [])),
    d('list_incidents', 'List PagerDuty incidents, auto-scoped to this project\'s team/service targets. Defaults to the last 7 days, all statuses, newest first.', obj({ statuses: SARR, serviceIds: SARR, teamIds: SARR, urgencies: SARR, since: S, until: S, limit: N }, [])),
    d('get_incident', 'Fetch one PagerDuty incident in full by its id.', obj({ incidentId: S }, ['incidentId'])),
    d('list_incident_alerts', 'List the raw monitoring-tool alerts grouped into one PagerDuty incident.', obj({ incidentId: S }, ['incidentId'])),
    d('list_incident_log_entries', 'Fetch the chronological timeline (trigger/notify/ack/escalate/resolve) of one PagerDuty incident.', obj({ incidentId: S }, ['incidentId'])),
  ];
}

export function filterPagerDutyToolDefs(defs: ToolDef[], ctx: { hasScope: boolean; signals: Set<PagerDutySignalKind> }): ToolDef[] {
  if (!ctx.hasScope) return [];
  return defs.filter((def) => {
    const bare = def.name.replace('integration.pagerduty.', '');
    if (bare === 'list_scope' || bare === 'describe_datasets') return true;
    const sig = SIGNAL_OF[bare];
    return sig ? ctx.signals.has(sig) : false;
  });
}

export async function callPagerDutyTool(ctx: PagerDutyToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.pagerduty.', '');

  if (bare === 'list_scope') {
    const targets = await listPagerDutyTargets(ctx.db, ctx.projectId);
    const conns = await listPagerDutyConnectionsForProject(ctx.db, ctx.orgId, ctx.projectId);
    const sigOf = (id: string) => {
      const c = conns.find((x) => x.id === id);
      if (!c?.enabled) return [];
      return (c.metadata as { availableSignals?: string[] })?.availableSignals ?? [];
    };
    return {
      content: JSON.stringify({
        scope: targets.map((t) => ({ team: t.teamName ?? t.teamId, service: t.serviceName ?? t.serviceId, label: t.label, signals: sigOf(t.connectionId) })),
      }),
    };
  }
  if (bare === 'describe_datasets') return { content: PAGERDUTY_DATASETS_REFERENCE };

  // Every other tool needs a connection. Resolve the first in-scope target's connection.
  const targets = await listPagerDutyTargets(ctx.db, ctx.projectId);
  if (targets.length === 0) return { content: 'no PagerDuty scope configured for this project', isError: true };

  const client = ctx.client ?? realPagerDutyClient;
  let creds: Awaited<ReturnType<typeof credsForPagerDutyConnection>>;
  if (ctx.client) {
    creds = { mode: 'api_keys', region: 'us', apiToken: '' };
  } else {
    try {
      const conn = await getPagerDutyConnection(ctx.db, ctx.orgId, targets[0]!.connectionId);
      if (!conn) return { content: 'PagerDuty connection not found', isError: true };
      creds = credsForPagerDutyConnection(conn, ctx.config);
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }

  try {
    switch (bare) {
      case 'list_services':
        return { content: JSON.stringify(await client.listServices(creds, { query: args.query })) };
      case 'list_incidents': {
        const scope = targetsToPagerDutyFilter(targets);
        const win = defaultIncidentWindow(new Date());
        return {
          content: JSON.stringify(await client.listIncidents(creds, {
            statuses: args.statuses ?? win.statuses,
            serviceIds: args.serviceIds ?? (scope.serviceIds.length ? scope.serviceIds : undefined),
            teamIds: args.teamIds ?? (scope.teamIds.length ? scope.teamIds : undefined),
            urgencies: args.urgencies,
            since: args.since ?? win.since,
            until: args.until,
            limit: args.limit ?? 25,
            sortBy: win.sortBy,
          })),
        };
      }
      case 'get_incident':
        return { content: JSON.stringify(await client.getIncident(creds, String(args.incidentId))) };
      case 'list_incident_alerts':
        return { content: JSON.stringify(await client.listIncidentAlerts(creds, String(args.incidentId))) };
      case 'list_incident_log_entries':
        return { content: JSON.stringify(await client.listIncidentLogEntries(creds, String(args.incidentId))) };
      default:
        return { content: `unknown pagerduty tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
