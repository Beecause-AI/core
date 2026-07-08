export interface PagerDutyAllowed { pairs: Set<string> }

/** Stable scope key for a (team, service) target; '*' marks an absent axis. */
export function pagerdutyScopeKey(teamId?: string | null, serviceId?: string | null): string {
  return `${teamId ?? '*'}::${serviceId ?? '*'}`;
}

export function validatePagerDutyScope(
  teamId: string | null,
  serviceId: string | null,
  allowed: PagerDutyAllowed,
): { ok: true } | { ok: false; error: string } {
  if (allowed.pairs.has(pagerdutyScopeKey(teamId, serviceId))) return { ok: true };
  return { ok: false, error: `(team ${teamId ?? '*'}, service ${serviceId ?? '*'}) is not in this project's PagerDuty scope` };
}

/** Union of distinct service + team ids across the project's targets, for incident filtering. */
export function targetsToFilter(
  targets: { teamId?: string | null; serviceId?: string | null }[],
): { serviceIds: string[]; teamIds: string[] } {
  const serviceIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const t of targets) {
    if (t.serviceId) serviceIds.add(t.serviceId);
    if (t.teamId) teamIds.add(t.teamId);
  }
  return { serviceIds: [...serviceIds], teamIds: [...teamIds] };
}

const SEVEN_DAYS_MS = 7 * 86_400_000;

/** Default list_incidents window: last 7 days, all statuses, newest first. */
export function defaultIncidentWindow(now: Date): { since: string; statuses: string[]; sortBy: string } {
  return {
    since: new Date(now.getTime() - SEVEN_DAYS_MS).toISOString(),
    statuses: ['triggered', 'acknowledged', 'resolved'],
    sortBy: 'created_at:desc',
  };
}
