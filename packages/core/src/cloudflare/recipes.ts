import { resolveWindow } from '../gcp/client.js';
import type { Window } from '../gcp/client.js';
import type { CfScope } from './validate.js';

/** ISO window → datetime filter bounds the adaptive datasets accept. */
function range(w: Window): { geq: string; leq: string } {
  const { start, end } = resolveWindow(w);
  return { geq: start, leq: end };
}

function scopeOpen(s: CfScope): string {
  return s.kind === 'zone'
    ? `viewer { zones(filter: { zoneTag: "${s.zoneTag}" }) {`
    : `viewer { accounts(filter: { accountTag: "${s.accountTag}" }) {`;
}
const scopeClose = '} }';

/** HTTP status breakdown + top failing paths over the window. */
export function httpErrorSummary(scope: CfScope, w: Window): string {
  const { geq, leq } = range(w);
  return `{ ${scopeOpen(scope)}
    httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: "${geq}", datetime_leq: "${leq}" }, orderBy: [count_DESC]) {
      count
      dimensions { edgeResponseStatus clientRequestPath clientRequestHTTPHost }
    }
  ${scopeClose} }`;
}

/** Origin + edge response-time percentiles over the window. */
export function latencySummary(scope: CfScope, w: Window): string {
  const { geq, leq } = range(w);
  return `{ ${scopeOpen(scope)}
    httpRequestsAdaptiveGroups(limit: 1, filter: { datetime_geq: "${geq}", datetime_leq: "${leq}" }) {
      count
      quantiles { edgeTimeToFirstByteMsP50 edgeTimeToFirstByteMsP99 originResponseDurationMsP50 originResponseDurationMsP99 }
    }
  ${scopeClose} }`;
}

/** WAF / firewall actions grouped by action/source/rule. Zone scope. */
export function firewallEvents(scope: CfScope, w: Window): string {
  const { geq, leq } = range(w);
  return `{ ${scopeOpen(scope)}
    firewallEventsAdaptiveGroups(limit: 50, filter: { datetime_geq: "${geq}", datetime_leq: "${leq}" }, orderBy: [count_DESC]) {
      count
      dimensions { action source ruleId clientCountryName }
    }
  ${scopeClose} }`;
}

/** Worker invocation errors by script. Account scope; optional script allow-list. */
export function workerErrors(scope: CfScope, w: Window & { scripts?: string[] }): string {
  const { geq, leq } = range(w);
  const scriptFilter = w.scripts && w.scripts.length
    ? `, scriptName_in: [${w.scripts.map((s) => `"${s}"`).join(', ')}]`
    : '';
  return `{ ${scopeOpen(scope)}
    workersInvocationsAdaptiveGroups(limit: 100, filter: { datetime_geq: "${geq}", datetime_leq: "${leq}"${scriptFilter} }, orderBy: [sum_errors_DESC]) {
      sum { requests errors subrequests }
      dimensions { scriptName status }
    }
  ${scopeClose} }`;
}
