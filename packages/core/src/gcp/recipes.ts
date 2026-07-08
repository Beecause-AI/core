// Best-effort RCA recipe queries for GCP (Cloud Monitoring PromQL + Cloud Logging filters).
// TUNE against the live API; metric names target Cloud Run by default.

/** Request error rate: share of 4xx/5xx by response_code_class over the query window. */
export function errorRatePromQL(): string {
  return [
    'sum by (response_code_class) (',
    '  rate({__name__="run.googleapis.com/request_count"}[5m])',
    ')',
  ].join('\n');
}

/** Request latency percentile (e.g. 0.95) from the latency distribution metric. */
export function latencyPromQL(quantile: number): string {
  return [
    `histogram_quantile(${quantile},`,
    '  sum by (le) (rate({__name__="run.googleapis.com/request_latencies"}[5m]))',
    ')',
  ].join('\n');
}

/** Cloud Logging filter for error-level entries. */
export function logErrorFilter(): string {
  return 'severity>=ERROR';
}
