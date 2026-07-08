/** Curated, RCA-focused reference of Cloudflare GraphQL Analytics datasets.
 *  Returned verbatim by integration.cloudflare.describe_datasets so the model can
 *  author valid queries without live schema introspection. */
export const CLOUDFLARE_DATASETS_REFERENCE = `
# Cloudflare GraphQL datasets (read-only) for RCA

Endpoint: a single GraphQL query under \`viewer\`. ALWAYS scope to your target:
- zone target:    viewer { zones(filter: { zoneTag: "<TARGET>" }) { <dataset>(...) { ... } } }
- account target: viewer { accounts(filter: { accountTag: "<TARGET>" }) { <dataset>(...) { ... } } }

Pass the target id (from list_targets) as the \`target\` argument; you must write the
matching zoneTag/accountTag, and it is validated.

## httpRequestsAdaptiveGroups (zone or account) — sampled raw-ish HTTP requests
Use for status-code spikes, error-rate, cache, country/path breakdowns.
- dimensions: edgeResponseStatus, clientCountryName, clientRequestHTTPHost, clientRequestPath, originResponseStatus, cacheStatus
- metrics: count, sum { edgeResponseBytes }, avg { sampleInterval }, ratio
- filter fields: datetime_geq, datetime_leq, edgeResponseStatus_gt, clientRequestHTTPHost, (account scope only) zoneTag
- example (zone, 5xx in last hour by path):
  { viewer { zones(filter: { zoneTag: "Z" }) {
    httpRequestsAdaptiveGroups(limit: 20, filter: { datetime_geq: "2026-06-14T00:00:00Z", edgeResponseStatus_gt: 499 },
      orderBy: [count_DESC]) {
      count dimensions { clientRequestPath edgeResponseStatus } } } } }

## httpRequests1hGroups / httpRequests1mGroups (zone) — aggregate time series
Use for request-volume and status-class trends. dimensions { datetime }, sum { requests, bytes, cachedRequests },
sum { responseStatusMap { edgeResponseStatus requests } }.

## firewallEventsAdaptive (zone) — WAF / firewall actions
dimensions: action, source, ruleId, clientIP, clientCountryName, clientRequestPath. metric: count.
Use for "blocked traffic" / WAF spikes.

## workersInvocationsAdaptiveGroups (account) — Workers invocations
dimensions: scriptName, status. metrics: sum { requests, errors, subrequests }, quantiles { cpuTimeP50 cpuTimeP99 }.
Use for Worker error rate / CPU regressions.

Time bounds: pass datetime_geq / datetime_leq (ISO8601) in the dataset filter. Keep limits small.
`.trim();
