/** Common-convention PromQL/LogQL for the RCA recipe tools. Metric/label names follow
 *  widespread Prometheus/Loki conventions; describe_datasets documents the assumptions, and
 *  the model should fall back to the raw query tools when a stack diverges. */
export function errorRatePromQL(): string {
  return 'sum(rate(http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total[5m])), 1)';
}

export function latencyPromQL(quantile: number): string {
  return `histogram_quantile(${quantile}, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`;
}

export function logErrorLogQL(): string {
  // {job=~".+"} matches any stream carrying a job label — the most common Loki selector.
  return '{job=~".+"} |~ "(?i)error|exception|fatal"';
}
