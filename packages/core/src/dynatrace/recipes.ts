export type DynatraceAllowed = { pairs: Set<string> };

export const SERVICE_LATENCY_METRIC = 'builtin:service.response.time';
export const SERVICE_ERROR_RATE_METRIC = 'builtin:service.errors.total.rate';

/** Stable key for a (managementZone?, service?) pair. */
export function dynatraceScopeKey(managementZone: string | null, service: string | null): string {
  return `${managementZone ?? '*'}::${service ?? '*'}`;
}

export function validateDynatraceScope(
  managementZone: string | null,
  service: string | null,
  allowed: DynatraceAllowed,
): { ok: true } | { ok: false; error: string } {
  if (allowed.pairs.has(dynatraceScopeKey(managementZone, service))) return { ok: true };
  const parts = [managementZone && `managementZone=${managementZone}`, service && `service=${service}`].filter(Boolean);
  return { ok: false, error: `Scope (${parts.join(', ') || 'none'}) is not in the configured Dynatrace targets for this project.` };
}

/** Build a Dynatrace entity selector for the scoped service. */
export function entitySelector(managementZone: string | null, service: string | null, type = 'SERVICE'): string {
  const parts = [`type(${type})`];
  if (managementZone) parts.push(`mzName("${managementZone}")`);
  if (service) parts.push(`entityName("${service}")`);
  return parts.join(',');
}

/** Build a Log Monitoring v2 search query for error-severity logs in scope. */
export function logErrorQuery(managementZone: string | null, service: string | null): string {
  const parts = ['(status=="ERROR" or loglevel=="ERROR")'];
  if (managementZone) parts.push(`dt.management_zone.name=="${managementZone}"`);
  if (service) parts.push(`dt.entity.service.name=="${service}"`);
  return parts.join(' AND ');
}

/** Append an aggregation transformation to a metric key. */
export function metricSelector(metric: string, aggregation = 'avg'): string {
  return `${metric}:${aggregation}`;
}
