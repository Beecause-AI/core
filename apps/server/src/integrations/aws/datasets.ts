/** Static reference returned by integration.aws.describe_datasets — what the raw
 *  tools can query, so the model writes valid CloudWatch / Logs Insights / X-Ray queries. */
export const AWS_DATASETS_REFERENCE = `# AWS datasets for RCA

Every tool call takes \`account\` + \`region\` — both must be in this project's scope
(call \`list_scope\` first to see the allowed account/region pairs).

## CloudWatch Metrics (query_metrics / list_metrics)
- query_metrics takes a structured query: { namespace, metricName, dimensions:[{name,value}], stat, period }.
  e.g. namespace "AWS/ApplicationELB", metricName "HTTPCode_Target_5XX_Count",
  dimensions [{name:"LoadBalancer", value:"app/my-lb/abc"}], stat "Sum", period 300.
- Common namespaces: AWS/ApplicationELB, AWS/ApiGateway, AWS/Lambda, AWS/ECS, AWS/RDS, AWS/SQS.
- stat is one of Average/Sum/Minimum/Maximum/SampleCount, or use latency_summary for percentiles.
- list_metrics(namespace) discovers metric names + dimensions.

## CloudWatch Logs Insights (query_logs / list_log_groups)
- query_logs takes { logGroupNames:[...], query } where query is the Logs Insights language, e.g.
  'fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 50'.
- list_log_groups(prefix) discovers log group names.

## X-Ray (list_traces / get_trace)
- list_traces takes an optional X-Ray filter expression, e.g. 'service("api") AND http.status = 500'
  or 'responsetime > 2' over a time window. get_trace takes traceIds from list_traces.

## CloudWatch Alarms (list_alarms)
- list_alarms returns alarm state; pass stateValue "ALARM" to see only firing alarms.

Prefer the recipe tools (error_rate_summary, latency_summary, log_error_summary) for common RCA
questions; use the raw tools for anything they don't cover.`;
