/** Static reference returned by integration.datadog.describe_datasets — what the raw tools can
 *  query, so the model writes valid Datadog metric queries and log/span filters. */
export const DATADOG_DATASETS_REFERENCE = `# Datadog datasets for RCA

Call \`list_scope\` first to see the (env, service?) pairs this project's assistants can query.
All tools take \`env\` (required) and optional \`service\`.

## Datadog Metrics (query_metrics / list_metrics)
- query_metrics takes { env, service?, query, window? } where \`query\` is a Datadog metric query string,
  e.g. \`avg:trace.http.request.duration{env:prod,service:checkout}\`.
  Use \`metric\` as a shorthand — if you pass \`metric\` without \`query\`, the tool builds the full query
  with the scoped tags automatically.
- list_metrics(env?) lists the active metric names visible to the API key.
- Universal tags: \`env\`, \`service\`, \`version\`, \`host\`.
- Common metrics by signal:
  - Request rate: \`trace.http.request.hits\`
  - Error rate: \`trace.http.request.errors\` / \`trace.http.request.hits\`
  - Latency: \`trace.http.request.duration\` (p50/p95/p99 via the recipe tools)
  - Infrastructure: \`system.cpu.user\`, \`system.mem.used\`, \`kubernetes.cpu.usage.total\`

## Datadog Logs (query_logs / log_error_summary)
- query_logs takes { env, service?, query, window?, limit? } where \`query\` is a Datadog Logs search string.
  The env/service scope is prepended automatically, so you only need to supply the extra filter terms.
  Examples: \`status:error\`, \`@http.status_code:500\`, \`"connection refused"\`.
- log_error_summary(env, service?, window?) aggregates error-severity logs and returns top error groups.
- Log facets: \`status\` (ok/warn/error/critical), \`service\`, \`host\`, \`source\`.
- Span/trace attributes surfaced in logs: \`@trace_id\`, \`@span_id\`, \`@resource_name\`, \`@http.status_code\`.

## Datadog APM Traces (list_traces / get_trace / error_rate_summary / latency_summary)
- list_traces takes { env, service?, filter?, window?, limit? } where \`filter\` is extra span search terms.
  The scope tag filter is prepended automatically. Spans with \`@http.status_code:[500 TO 599]\` are returned.
  Default filter finds error spans; pass \`filter\` to narrow further (e.g. \`@resource_name:"/api/checkout"\`).
- get_trace(env, service?, traceId, window?) fetches all spans for one trace id.
- error_rate_summary(env, service?, window?) aggregates span counts (error vs total) to compute error %.
- latency_summary(env, service?, window?) aggregates span duration percentiles (p50/p95/p99).
- Span attributes: \`@trace_id\`, \`@span_id\`, \`@resource_name\`, \`@http.status_code\`, \`@duration\`,
  \`@http.method\`, \`@http.url\`.
- Use list_traces to find a traceId, then get_trace to see every span end-to-end.

## Datadog Monitors / Alerts (list_monitors)
- list_monitors(env?, service?, states?) lists monitor definitions and their alert state.
  Optionally pass \`states\` to filter by state (e.g. \`Alert\`, \`Warn\`, \`No Data\`).
  Filters monitors by the \`env\`/\`service\` tags when provided.

## Time windows
All tools accept a \`window\` string (e.g. \`"15m"\`, \`"1h"\`, \`"24h"\`, \`"7d"\`) or explicit
\`start\`/\`end\` ISO timestamps. Default is \`1h\`.

Prefer the recipe tools (error_rate_summary, latency_summary, log_error_summary) for common RCA
questions; use the raw tools for anything they don't cover.`;
