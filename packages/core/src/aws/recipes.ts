export interface AwsAllowed { pairs: Set<string> } // members are `${account}:${region}`

export const scopeKey = (account: string, region: string) => `${account}:${region}`;

export function validateAwsScope(account: string, region: string, allowed: AwsAllowed): { ok: true } | { ok: false; error: string } {
  if (allowed.pairs.has(scopeKey(account, region))) return { ok: true };
  return { ok: false, error: `account ${account} / region ${region} is not in this project's AWS scope` };
}

/** Percentile statistics used by latency_summary (CloudWatch ExtendedStatistic values). */
export const latencyStatistics = (): string[] => ['p50', 'p95', 'p99'];

/** CloudWatch Logs Insights query for the log_error_summary recipe. */
export const logErrorQuery = (): string =>
  'fields @timestamp, @message | filter @message like /(?i)(error|exception|fatal|traceback)/ | sort @timestamp desc | limit 50';
