import { pdBaseUrl, pdHeaders } from './auth.js';
import type { PagerDutyCreds } from './auth.js';

export interface ListIncidentsParams {
  statuses?: string[];
  serviceIds?: string[];
  teamIds?: string[];
  urgencies?: string[];
  since?: string;
  until?: string;
  limit?: number;
  sortBy?: string;
}

async function pdFetch(creds: PagerDutyCreds, method: string, path: string): Promise<unknown> {
  const res = await fetch(`${pdBaseUrl(creds.region)}${path}`, { method, headers: pdHeaders(creds) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`PagerDuty ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

/** URLSearchParams that repeats array keys as `key[]=v` (PagerDuty REST convention). */
function pdQuery(params: Record<string, string | number | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) qs.append(`${k}[]`, item);
    else qs.append(k, String(v));
  }
  return qs.toString();
}

export interface PagerDutyClient {
  validate(creds: PagerDutyCreds): Promise<void>;
  listServices(creds: PagerDutyCreds, p: { query?: string; teamIds?: string[]; limit?: number }): Promise<unknown>;
  listIncidents(creds: PagerDutyCreds, p: ListIncidentsParams): Promise<unknown>;
  getIncident(creds: PagerDutyCreds, id: string): Promise<unknown>;
  listIncidentAlerts(creds: PagerDutyCreds, id: string): Promise<unknown>;
  listIncidentLogEntries(creds: PagerDutyCreds, id: string): Promise<unknown>;
}

export const realPagerDutyClient: PagerDutyClient = {
  async validate(creds) {
    await pdFetch(creds, 'GET', '/abilities');
  },
  async listServices(creds, p) {
    const qs = pdQuery({ query: p.query, 'team_ids': p.teamIds, limit: p.limit ?? 25 });
    return pdFetch(creds, 'GET', `/services?${qs}`);
  },
  async listIncidents(creds, p) {
    const qs = pdQuery({
      statuses: p.statuses,
      service_ids: p.serviceIds,
      team_ids: p.teamIds,
      urgencies: p.urgencies,
      since: p.since,
      until: p.until,
      sort_by: p.sortBy ?? 'created_at:desc',
      limit: p.limit ?? 25,
    });
    return pdFetch(creds, 'GET', `/incidents?${qs}`);
  },
  async getIncident(creds, id) {
    return pdFetch(creds, 'GET', `/incidents/${encodeURIComponent(id)}`);
  },
  async listIncidentAlerts(creds, id) {
    return pdFetch(creds, 'GET', `/incidents/${encodeURIComponent(id)}/alerts`);
  },
  async listIncidentLogEntries(creds, id) {
    return pdFetch(creds, 'GET', `/incidents/${encodeURIComponent(id)}/log_entries?is_overview=true`);
  },
};

const testDefaults: PagerDutyClient = {
  async validate() {},
  async listServices() { return { services: [] }; },
  async listIncidents() { return { incidents: [] }; },
  async getIncident() { return { incident: {} }; },
  async listIncidentAlerts() { return { alerts: [] }; },
  async listIncidentLogEntries() { return { log_entries: [] }; },
};

export function makePagerDutyClientForTest(overrides?: Partial<PagerDutyClient>): PagerDutyClient {
  return { ...testDefaults, ...overrides };
}
