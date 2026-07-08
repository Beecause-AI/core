export type IntegrationId = 'github' | 'gitlab' | 'slack' | 'teams' | 'gcp' | 'cloudflare' | 'sentry' | 'grafana' | 'aws' | 'azure' | 'datadog' | 'dynatrace' | 'pagerduty';

export type IntegrationGroupId = 'repository' | 'communications' | 'observability';

/** Display order + labels for the grouped integration lists. */
export const INTEGRATION_GROUPS: { id: IntegrationGroupId; label: string }[] = [
  { id: 'repository', label: 'Repository' },
  { id: 'communications', label: 'Communications' },
  { id: 'observability', label: 'Observability' },
];

export type Integration = {
  id: IntegrationId;
  name: string;
  group: IntegrationGroupId;
};

/** Single source of truth for which tools exist and how they're grouped. */
export const INTEGRATIONS: Integration[] = [
  { id: 'github', name: 'GitHub', group: 'repository' },
  { id: 'gitlab', name: 'GitLab', group: 'repository' },
  { id: 'slack', name: 'Slack', group: 'communications' },
  { id: 'teams', name: 'Microsoft Teams', group: 'communications' },
  { id: 'gcp', name: 'Google Cloud', group: 'observability' },
  { id: 'cloudflare', name: 'Cloudflare', group: 'observability' },
  { id: 'sentry', name: 'Sentry', group: 'observability' },
  { id: 'grafana', name: 'Grafana', group: 'observability' },
  { id: 'aws', name: 'AWS', group: 'observability' },
  { id: 'azure', name: 'Azure', group: 'observability' },
  { id: 'datadog', name: 'Datadog', group: 'observability' },
  { id: 'dynatrace', name: 'Dynatrace', group: 'observability' },
  { id: 'pagerduty', name: 'PagerDuty', group: 'observability' },
];

/** Walk the groups in display order, yielding each group with its members mapped
 *  through `pick`. Groups with no members are skipped so callers can render
 *  one section per non-empty group. */
export function groupedIntegrations<T>(
  pick: (integration: Integration) => T,
): { id: IntegrationGroupId; label: string; items: T[] }[] {
  return INTEGRATION_GROUPS.map((g) => ({
    ...g,
    items: INTEGRATIONS.filter((i) => i.group === g.id).map(pick),
  })).filter((g) => g.items.length > 0);
}
