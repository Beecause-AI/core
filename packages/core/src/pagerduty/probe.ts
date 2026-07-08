import type { PagerDutyClient } from './client.js';
import type { PagerDutyCreds } from './auth.js';

export type PagerDutySignal = 'alerts';
export interface SignalResult { ok: boolean; error?: string }
export type PagerDutySignalReport = Record<PagerDutySignal, SignalResult>;

export const SIGNAL_TOOLS: Record<PagerDutySignal, string[]> = {
  alerts: [
    'integration.pagerduty.list_incidents',
    'integration.pagerduty.get_incident',
    'integration.pagerduty.list_incident_alerts',
    'integration.pagerduty.list_incident_log_entries',
  ],
};

export async function probeSignals(client: PagerDutyClient, creds: PagerDutyCreds): Promise<PagerDutySignalReport> {
  // Validate the key first; a 401 here means the token itself is wrong.
  try {
    await client.validate(creds);
  } catch (err: any) {
    if (err?.status === 401) return { alerts: { ok: false, error: 'invalid API token' } };
    return { alerts: { ok: false, error: err?.message ?? String(err) } };
  }
  // Then confirm incidents read access.
  try {
    await client.listIncidents(creds, { limit: 1 });
    return { alerts: { ok: true } };
  } catch (err: any) {
    if (err?.status === 403) return { alerts: { ok: false, error: 'the API key needs read access to incidents' } };
    return { alerts: { ok: false, error: err?.message ?? String(err) } };
  }
}
