/** Static reference returned by integration.pagerduty.describe_datasets — what the
 *  incident tools can query and how to filter, so the model writes valid calls. */
export const PAGERDUTY_DATASETS_REFERENCE = `# PagerDuty datasets for RCA

Call \`list_scope\` first to see the (team, service?) targets this project's assistants can query.
Incident tools auto-apply the in-scope team/service ids as filters; you may narrow further.

## Incidents (list_incidents / get_incident)
- list_incidents filters: { statuses?, serviceIds?, teamIds?, urgencies?, since?, until?, limit? }
  - statuses: triggered | acknowledged | resolved (default: all three)
  - urgencies: high | low
  - since / until: ISO-8601 timestamps; default window is the last 7 days
  - results are newest-first (created_at:desc); default limit 25
- An incident has: id, incident_number, title, status, urgency, created_at,
  last_status_change_at, resolved_at?, service{ id, summary }, assignments[],
  teams[], escalation_policy{ id, summary }, html_url, incident_key.
- get_incident(incidentId) returns the full incident object.

## Alerts (list_incident_alerts)
- The raw alerts a monitoring tool sent that PagerDuty grouped into the incident.
- Each alert has: id, status, alert_key, created_at, severity, service,
  body{ details, ... } (the original payload — error text, host, check name),
  integration{ summary } (which monitoring tool fired it).

## Timeline (list_incident_log_entries)
- The incident's chronological log: trigger, notify, acknowledge, escalate, annotate
  (notes), resolve — each with created_at and the agent/channel that caused it.
- Use this to establish WHEN the incident started and how responders acted.

## Services (list_services)
- Discover services (id, name, status) in the account; use ids to filter incidents.
`;
