/** Static reference returned by integration.gcp.describe_datasets — what the
 *  raw tools can query, so the model writes valid PromQL / Logging filters. */
export const GCP_DATASETS_REFERENCE = `# GCP datasets for RCA

## Cloud Monitoring (PromQL via query_metrics)
- Metric names use the form {__name__="<type>"}, e.g. "run.googleapis.com/request_count",
  "run.googleapis.com/request_latencies", "compute.googleapis.com/instance/cpu/utilization".
- Common labels: response_code_class, response_code, service_name, location, revision_name.
- Use rate(...[5m]) for counters; histogram_quantile(q, sum by (le) (...)) for latencies.

## Cloud Logging (query_logs)
- filter is a Logging query, e.g. 'severity>=ERROR', 'resource.type="cloud_run_revision"',
  'logName:"%2Flogs%2Fstderr"'. Combine with AND/OR.

## Cloud Trace (list_traces / get_trace)
- list_traces filter examples: '+root:/api', 'latency:200ms'. get_trace takes a traceId.

## Cloud Error Reporting (list_error_groups / get_error_group)
- list_error_groups returns the top error groups over a window (count, affected users,
  first/last seen, representative message), ordered by count. Bound the window with
  window (e.g. "1h", "1d", "7d") — it maps to the nearest Error Reporting period.
- get_error_group takes a groupId from list_error_groups and returns that group's stats
  plus a sample of recent events, each carrying its full stack trace. Use it to dig into
  a specific error after spotting it in list_error_groups.

Prefer the recipe tools (error_rate_summary, latency_summary, log_error_summary) for
common RCA questions; use the raw tools for anything they don't cover.`;
