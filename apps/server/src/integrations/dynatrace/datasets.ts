/** Static reference returned by integration.dynatrace.describe_datasets — what the raw tools can
 *  query, so the model writes valid Dynatrace metric selectors and log/problem filters. */
export const DYNATRACE_DATASETS_REFERENCE = `# Dynatrace datasets for RCA

Call \`list_scope\` first to see the (managementZone, service?) targets this project's assistants can query.
Tools accept optional \`managementZone\` and \`service\`; with a single target they default automatically.

## Metrics (query_metrics / list_metrics)
- query_metrics takes { managementZone?, service?, metricSelector, window? }. \`metricSelector\` is a Dynatrace
  metric key + transformation, e.g. \`builtin:service.response.time:avg\` or \`builtin:service.errors.total.rate:avg\`.
  The (managementZone, service) scope is applied as an entitySelector automatically.
- list_metrics({ text? }) discovers metric keys visible to the token.
- Key service metrics: \`builtin:service.response.time\` (latency, microseconds), \`builtin:service.errors.total.rate\`
  (error %), \`builtin:service.requestCount.total\` (throughput). Host: \`builtin:host.cpu.usage\`, \`builtin:host.mem.usage\`.
- Prefer the recipe tools error_rate_summary / latency_summary instead of hand-writing these.

## Logs (query_logs / log_error_summary)
- query_logs takes { managementZone?, service?, query, window?, limit? }. \`query\` is a Dynatrace log search
  expression; scope is added automatically. Examples: \`status=="ERROR"\`, \`loglevel=="ERROR"\`, \`content contains "timeout"\`.
- log_error_summary aggregates error-severity logs in scope.

## Problems (list_problems / get_problem)
- list_problems takes { managementZone?, service?, problemSelector?, window? }. Davis AI problems are the alert analog;
  each carries a root-cause entity and affected entities. \`problemSelector\` example: \`status("OPEN")\`.
- get_problem({ problemId }) returns one problem's full detail (root cause, impact, evidence) — the fastest RCA drill-in.

## Time windows
- Pass \`window\` as '15m' | '1h' | '6h' | '24h' | '7d', or explicit { start, end } ISO timestamps. Default 1h.
`;
