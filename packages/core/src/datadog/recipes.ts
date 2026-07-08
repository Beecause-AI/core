/** Scope validation + query/tag-filter builders for Datadog integration. */

export type DatadogAllowed = { pairs: Set<string> };

/** Canonical key for a (env, service?) pair stored in DatadogAllowed. */
export function datadogScopeKey(env: string, service: string | null): string {
  return `${env}::${service ?? '*'}`;
}

/** Validates that the (env, service?) pair is in the allowed set. */
export function validateDatadogScope(
  env: string,
  service: string | null,
  allowed: DatadogAllowed,
): { ok: true } | { ok: false; error: string } {
  const key = datadogScopeKey(env, service);
  if (allowed.pairs.has(key)) return { ok: true };
  const label = service ? `env=${env}, service=${service}` : `env=${env}`;
  return { ok: false, error: `Scope (${label}) is not in the configured Datadog targets for this project.` };
}

/** Builds a Datadog tag filter string, e.g. "env:prod service:checkout extra". */
export function tagFilter(env: string, service: string | null, extra?: string): string {
  const parts: string[] = [`env:${env}`];
  if (service) parts.push(`service:${service}`);
  if (extra) parts.push(extra);
  return parts.join(' ');
}

/** Builds a log search query for error logs in scope. */
export function logErrorQuery(env: string, service: string | null): string {
  return `${tagFilter(env, service)} status:error`;
}

/** Builds a span/trace search query for error spans in scope. */
export function spanErrorQuery(env: string, service: string | null): string {
  return `${tagFilter(env, service)} @http.status_code:[500 TO 599]`;
}

/** Builds a Datadog metric query string. */
export function metricQuery(
  metric: string,
  env: string,
  service: string | null,
  aggr?: string,
): string {
  const tags = tagFilter(env, service).replace(/ /g, ',');
  return `${aggr ?? 'avg'}:${metric}{${tags}}`;
}
