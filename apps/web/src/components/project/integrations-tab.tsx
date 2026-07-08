'use client';

import { useEffect, useState } from 'react';
import { api, type AzureTarget, type CloudflareConnection, type CloudflareTarget, type DatadogTarget, type DynatraceTarget, type PagerDutyTarget, type GcpConnection, type GcpTarget, type GrafanaConnection, type GrafanaTarget, type AwsTarget, type ProjectRepo, type ProjectSlackChannels, type ProjectTeamsChannels, type SentryConnection, type SentryTarget } from '../../lib/api';
import { integrationProviderHref } from '../../lib/project-path';
import { groupedIntegrations, type IntegrationId } from '../../lib/integrations';
import { Card } from '../ui/card';
import { IntegrationMark } from '../ui/integration-mark';

/** Project Integrations landing: one row per integration linking to its own page.
 *  No inline details — each integration manages its scope + write policy on its page. */
export function IntegrationsTab({ slug }: { slug: string; isAdmin: boolean }) {
  const [repos, setRepos] = useState<ProjectRepo[] | null>(null);
  const [gitlabRepos, setGitlabRepos] = useState<ProjectRepo[] | null>(null);
  const [slack, setSlack] = useState<ProjectSlackChannels | null>(null);
  const [teams, setTeams] = useState<ProjectTeamsChannels | null>(null);
  const [gcp, setGcp] = useState<GcpTarget[] | null>(null);
  const [gcpConnection, setGcpConnection] = useState<GcpConnection | null | undefined>(undefined);
  const [cloudflare, setCloudflare] = useState<CloudflareTarget[] | null>(null);
  const [cfConnection, setCfConnection] = useState<CloudflareConnection | null | undefined>(undefined);
  const [sentry, setSentry] = useState<SentryTarget[] | null>(null);
  const [sentryConnection, setSentryConnection] = useState<SentryConnection | null | undefined>(undefined);
  const [grafana, setGrafana] = useState<GrafanaTarget[] | null>(null);
  const [grafanaConnection, setGrafanaConnection] = useState<GrafanaConnection | null | undefined>(undefined);
  const [aws, setAws] = useState<AwsTarget[] | null>(null);
  const [azure, setAzure] = useState<AzureTarget[] | null>(null);
  const [datadog, setDatadog] = useState<DatadogTarget[] | null>(null);
  const [dynatrace, setDynatrace] = useState<DynatraceTarget[] | null>(null);
  const [pagerduty, setPagerduty] = useState<PagerDutyTarget[] | null>(null);

  useEffect(() => {
    api<ProjectRepo[]>(`/api/org/projects/${slug}/repos`).then(setRepos).catch(() => setRepos([]));
    api<ProjectRepo[]>(`/api/org/projects/${slug}/gitlab-repos`).then(setGitlabRepos).catch(() => setGitlabRepos([]));
    api<ProjectSlackChannels>(`/api/org/projects/${slug}/slack-channels`).then(setSlack).catch(() => setSlack(null));
    api<ProjectTeamsChannels>(`/api/org/projects/${slug}/teams-channels`).then(setTeams).catch(() => setTeams(null));
    api<{ targets: GcpTarget[] }>(`/api/org/projects/${slug}/gcp/targets`).then((r) => setGcp(r.targets)).catch(() => setGcp([]));
    api<{ connection: GcpConnection | null }>(`/api/org/projects/${slug}/gcp/connection`).then((r) => setGcpConnection(r.connection)).catch(() => setGcpConnection(null));
    api<{ targets: CloudflareTarget[] }>(`/api/org/projects/${slug}/cloudflare/targets`).then((r) => setCloudflare(r.targets)).catch(() => setCloudflare([]));
    api<{ connection: CloudflareConnection | null }>(`/api/org/projects/${slug}/cloudflare/connection`).then((r) => setCfConnection(r.connection)).catch(() => setCfConnection(null));
    api<{ targets: SentryTarget[] }>(`/api/org/projects/${slug}/sentry/targets`).then((r) => setSentry(r.targets)).catch(() => setSentry([]));
    api<{ connection: SentryConnection | null }>(`/api/org/projects/${slug}/sentry/connection`).then((r) => setSentryConnection(r.connection)).catch(() => setSentryConnection(null));
    api<{ targets: GrafanaTarget[] }>(`/api/org/projects/${slug}/grafana/targets`).then((r) => setGrafana(r.targets)).catch(() => setGrafana([]));
    api<{ connection: GrafanaConnection | null }>(`/api/org/projects/${slug}/grafana/connection`).then((r) => setGrafanaConnection(r.connection)).catch(() => setGrafanaConnection(null));
    api<{ targets: AwsTarget[] }>(`/api/org/projects/${slug}/aws/targets`).then((r) => setAws(r.targets)).catch(() => setAws([]));
    api<{ targets: AzureTarget[] }>(`/api/org/projects/${slug}/azure/targets`).then((r) => setAzure(r.targets)).catch(() => setAzure([]));
    api<{ targets: DatadogTarget[] }>(`/api/org/projects/${slug}/datadog/targets`).then((r) => setDatadog(r.targets)).catch(() => setDatadog([]));
    api<{ targets: DynatraceTarget[] }>(`/api/org/projects/${slug}/dynatrace/targets`).then((r) => setDynatrace(r.targets)).catch(() => setDynatrace([]));
    api<{ targets: PagerDutyTarget[] }>(`/api/org/projects/${slug}/pagerduty/targets`).then((r) => setPagerduty(r.targets)).catch(() => setPagerduty([]));
  }, [slug]);

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const details: Record<IntegrationId, { description?: string; summary: string }> = {
    github: { summary: repos === null ? '…' : count(repos.length, 'repository', 'repositories') },
    gitlab: { summary: gitlabRepos === null ? '…' : count(gitlabRepos.length, 'repository', 'repositories') },
    slack: {
      summary: slack === null ? '…' : !slack.connected ? 'Not connected for this org' : count(slack.assigned.length, 'channel', 'channels'),
    },
    teams: {
      summary: teams === null ? '…' : !teams.connected ? 'Not connected for this org' : count(teams.assigned.length, 'channel', 'channels'),
    },
    gcp: {
      description: 'Query metrics, logs, traces, and errors for RCA',
      summary: gcpConnection === undefined || gcp === null ? '…'
        : gcpConnection === null ? 'Not connected'
        : gcp.length === 0 ? 'All projects'
        : count(gcp.length, 'project', 'projects'),
    },
    cloudflare: {
      description: 'Query Cloudflare logs and metrics for RCA',
      summary: cfConnection === undefined || cloudflare === null ? '…'
        : cfConnection === null ? 'Not connected'
        : cloudflare.length === 0 ? 'All resources'
        : count(cloudflare.length, 'resource', 'resources'),
    },
    sentry: {
      description: 'Query issues and stack traces for RCA',
      summary: sentryConnection === undefined || sentry === null ? '…'
        : sentryConnection === null ? 'Not connected'
        : sentry.length === 0 ? 'All projects'
        : count(sentry.length, 'project', 'projects'),
    },
    grafana: {
      description: 'Query metrics, logs, and traces for RCA',
      summary: grafanaConnection === undefined || grafana === null ? '…'
        : grafanaConnection === null ? 'Not connected'
        : grafana.length === 0 ? 'All datasources'
        : count(grafana.length, 'datasource', 'datasources'),
    },
    aws: {
      description: 'Query metrics, logs, traces, and alarms for RCA',
      summary: aws === null ? '…'
        : aws.length === 0 ? 'Not connected'
        : count(aws.length, 'account/region', 'accounts/regions'),
    },
    azure: {
      description: 'Query Azure Monitor metrics, logs, traces, and alerts for RCA',
      summary: azure === null ? '…'
        : azure.length === 0 ? 'Not connected'
        : count(azure.length, 'subscription', 'subscriptions'),
    },
    datadog: {
      description: 'Query Datadog metrics, logs, traces, and monitors for RCA',
      summary: datadog === null ? '…'
        : datadog.length === 0 ? 'Not connected'
        : count(datadog.length, 'target', 'targets'),
    },
    dynatrace: {
      description: 'Query Dynatrace metrics, logs, and Davis AI problems for RCA',
      summary: dynatrace === null ? '…'
        : dynatrace.length === 0 ? 'Not connected'
        : count(dynatrace.length, 'target', 'targets'),
    },
    pagerduty: {
      description: 'Survey PagerDuty incidents and alerts for RCA',
      summary: pagerduty === null ? '…'
        : pagerduty.length === 0 ? 'Not connected'
        : count(pagerduty.length, 'target', 'targets'),
    },
  };

  const groups = groupedIntegrations((i) => ({ ...i, ...details[i.id] }));

  return (
    <section className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{group.label}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.items.map((it) => (
              <a key={it.id} href={integrationProviderHref(slug, it.id)} className="block no-underline">
                <Card className="transition hover:-translate-y-0.5">
                  <div className="flex items-start gap-3">
                    <IntegrationMark provider={it.id} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-lg font-medium text-fg">{it.name}</span>
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="size-4 shrink-0 text-fg-faint">
                          <path d="m8 5 5 5-5 5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      {it.description && <span className="text-sm text-fg-muted">{it.description}</span>}
                      <span className="text-sm text-fg-faint">{it.summary}</span>
                    </div>
                  </div>
                </Card>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
