/** Static reference returned by integration.grafana.describe_datasets — what the raw
 *  tools can query, so the model writes valid PromQL / LogQL / TraceQL. */
export const GRAFANA_DATASETS_REFERENCE = `# Grafana datasets for RCA

Queries run through a Grafana instance against its Prometheus (metrics), Loki (logs),
and Tempo (traces) datasources. Call \`list_scope\` first to see the datasources you may
query and their uids; pass \`datasourceUid\` to target one (optional when exactly one
datasource of the needed type is in scope).

## Metrics — Prometheus (query_metrics, PromQL)
- Omit \`step\` for an instant query; pass \`step\` (e.g. "60s") for a range query.
- Counters: use rate(metric[5m]); latency histograms: histogram_quantile(0.95, sum(rate(metric_bucket[5m])) by (le)).

## Logs — Loki (query_logs, LogQL)
- A query needs a stream selector, e.g. {app="api"} or {job=~".+"}, optionally piped:
  {app="api"} |= "error" | json. Bound time with window OR start/end.

## Traces — Tempo (list_traces / get_trace, TraceQL)
- list_traces takes an optional TraceQL query, e.g. { status = error } or
  { duration > 500ms }. get_trace takes a traceId from list_traces.

## RCA recipes (error_rate_summary / latency_summary / log_error_summary)
- These assume common metric/label names: http_requests_total{status},
  http_request_duration_seconds_bucket, and a Loki "job" label. If your stack uses
  different names, use the raw query tools instead.`;
