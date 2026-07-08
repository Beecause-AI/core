'use client';

import { useEffect, useState } from 'react';
import { api, getGitlabConnection, getTeamsConnection, type GcpConnection, type GithubConnection, type GitlabConnection, type CloudflareConnection, type SentryConnection, type GrafanaConnection, type AwsConnection, type AzureConnection, type DatadogConnection, type DynatraceConnection, type PagerDutyConnection, type TeamsConnection, type OrgInfo } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationMark } from '../../../components/ui/integration-mark';
import { groupedIntegrations, type IntegrationId } from '../../../lib/integrations';

type ProviderDetail = {
  blurb: string;
  href: string;
  status: 'connected' | 'disconnected';
  detail?: string;
};

export default function IntegrationsPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [github, setGithub] = useState<GithubConnection | null>(null);
  const [gitlab, setGitlab] = useState<GitlabConnection | null>(null);
  const [slack, setSlack] = useState<{ enabled: boolean; accountLabel: string | null } | null>(null);
  const [teams, setTeams] = useState<TeamsConnection | null>(null);
  const [gcp, setGcp] = useState<GcpConnection[] | null>(null);
  const [cloudflare, setCloudflare] = useState<CloudflareConnection[] | null>(null);
  const [sentry, setSentry] = useState<SentryConnection[] | null>(null);
  const [grafana, setGrafana] = useState<GrafanaConnection[] | null>(null);
  const [aws, setAws] = useState<AwsConnection[] | null>(null);
  const [azure, setAzure] = useState<AzureConnection[] | null>(null);
  const [datadog, setDatadog] = useState<DatadogConnection[] | null>(null);
  const [dynatrace, setDynatrace] = useState<DynatraceConnection[] | null>(null);
  const [pagerduty, setPagerduty] = useState<PagerDutyConnection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<OrgInfo>('/api/org'),
      api<GithubConnection | null>('/api/github/connection'),
      getGitlabConnection(),
      api<{ enabled: boolean; accountLabel: string | null } | null>('/api/slack/connection'),
      api<{ connections: GcpConnection[] }>('/api/integrations/gcp/connections'),
      api<{ connections: CloudflareConnection[] }>('/api/integrations/cloudflare/connections'),
      api<{ connections: SentryConnection[] }>('/api/integrations/sentry/connections'),
      api<{ connections: GrafanaConnection[] }>('/api/integrations/grafana/connections'),
      api<{ connections: AwsConnection[] }>('/api/integrations/aws/connections'),
      api<{ connections: AzureConnection[] }>('/api/integrations/azure/connections'),
      api<{ connections: DatadogConnection[] }>('/api/integrations/datadog/connections'),
      api<{ connections: DynatraceConnection[] }>('/api/integrations/dynatrace/connections'),
      api<{ connections: PagerDutyConnection[] }>('/api/integrations/pagerduty/connections'),
      getTeamsConnection(),
    ])
      .then(([o, g, gl, s, gc, cf, se, gf, aw, az, dd, dt, pd, tm]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setGithub(g);
        setGitlab(gl);
        setSlack(s);
        setGcp(gc.connections);
        setCloudflare(cf.connections);
        setSentry(se.connections);
        setGrafana(gf.connections);
        setAws(aw.connections);
        setAzure(az.connections);
        setDatadog(dd.connections);
        setDynatrace(dt.connections);
        setPagerduty(pd.connections);
        setTeams(tm);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load integrations');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <WorkspaceShell org={org}><PageHeader title="Integrations" /><Skeleton rows={3} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="Integrations" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage integrations." />
    </WorkspaceShell>
  );

  const connections = (n: number) => `${n} connection${n === 1 ? '' : 's'}`;
  const details: Record<IntegrationId, ProviderDetail> = {
    github: {
      href: '/admin/github',
      blurb: 'Connect repositories — issues, pull requests, and branch activity.',
      status: github?.enabled ? 'connected' : 'disconnected',
      detail: github?.accountLabel ?? undefined,
    },
    gitlab: {
      href: '/admin/gitlab',
      blurb: 'Connect repositories — merge requests and branch activity.',
      status: gitlab?.enabled ? 'connected' : 'disconnected',
      detail: gitlab?.accountLabel ?? undefined,
    },
    slack: {
      href: '/admin/slack',
      blurb: 'Assistant, notifications, and slash commands in your workspace.',
      status: slack?.enabled ? 'connected' : 'disconnected',
      detail: slack?.accountLabel ?? undefined,
    },
    teams: {
      href: '/admin/teams',
      blurb: 'Run RCA right from a Microsoft Teams channel.',
      status: teams?.enabled ? 'connected' : 'disconnected',
      detail: teams?.enabled ? (teams.metadata?.tenantName ?? teams.accountLabel ?? undefined) : undefined,
    },
    gcp: {
      href: '/admin/gcp',
      blurb: 'Query metrics, logs, traces, and errors from your GCP projects during RCA.',
      status: gcp && gcp.length > 0 ? 'connected' : 'disconnected',
      detail: gcp && gcp.length > 0 ? connections(gcp.length) : undefined,
    },
    cloudflare: {
      href: '/admin/cloudflare',
      blurb: 'Query Cloudflare analytics, logs, and Workers during RCA.',
      status: cloudflare && cloudflare.length > 0 ? 'connected' : 'disconnected',
      detail: cloudflare && cloudflare.length > 0 ? connections(cloudflare.length) : undefined,
    },
    sentry: {
      href: '/admin/sentry',
      blurb: 'Query issues, events, and stack traces from your Sentry projects during RCA.',
      status: sentry && sentry.length > 0 ? 'connected' : 'disconnected',
      detail: sentry && sentry.length > 0 ? connections(sentry.length) : undefined,
    },
    grafana: {
      href: '/admin/grafana',
      blurb: 'Query metrics, logs, and traces from your Grafana (Prometheus/Loki/Tempo) stack during RCA.',
      status: grafana && grafana.length > 0 ? 'connected' : 'disconnected',
      detail: grafana && grafana.length > 0 ? connections(grafana.length) : undefined,
    },
    aws: {
      href: '/admin/aws',
      blurb: 'Query metrics, logs, traces, and alarms from your AWS resources during RCA.',
      status: aws && aws.length > 0 ? 'connected' : 'disconnected',
      detail: aws && aws.length > 0 ? connections(aws.length) : undefined,
    },
    azure: {
      href: '/admin/azure',
      blurb: 'Query Azure Monitor metrics, Log Analytics (KQL), Application Insights traces, and alerts from your subscriptions during RCA.',
      status: azure && azure.length > 0 ? 'connected' : 'disconnected',
      detail: azure && azure.length > 0 ? connections(azure.length) : undefined,
    },
    datadog: {
      href: '/admin/datadog',
      blurb: 'Query Datadog metrics, logs, APM traces, and monitors across your environments and services during RCA.',
      status: datadog && datadog.length > 0 ? 'connected' : 'disconnected',
      detail: datadog && datadog.length > 0 ? connections(datadog.length) : undefined,
    },
    dynatrace: {
      href: '/admin/dynatrace',
      blurb: 'Query Dynatrace metrics, logs, and Davis AI problems across your management zones and services during RCA.',
      status: dynatrace && dynatrace.length > 0 ? 'connected' : 'disconnected',
      detail: dynatrace && dynatrace.length > 0 ? connections(dynatrace.length) : undefined,
    },
    pagerduty: {
      href: '/admin/pagerduty',
      blurb: 'Survey PagerDuty incidents and the alerts behind them to confirm what is firing in production during RCA.',
      status: pagerduty && pagerduty.length > 0 ? 'connected' : 'disconnected',
      detail: pagerduty && pagerduty.length > 0 ? connections(pagerduty.length) : undefined,
    },
  };

  const groups = groupedIntegrations((i) => ({ ...i, ...details[i.id] }));

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Integrations" />
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}
      <p className="mb-6 max-w-xl text-sm text-fg-muted">Connect Beecause to the tools your team already uses.</p>

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{group.label}</h2>
            {group.items.map((p) => (
              <a key={p.id} href={p.href} className="block no-underline">
                <Card className="transition hover:border-accent">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <IntegrationMark provider={p.id} />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-lg font-medium">{p.name}</span>
                        <span className="text-sm text-fg-muted">{p.blurb}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {p.status === 'connected' ? (
                        <Badge status="ok">{p.detail ? `Connected · ${p.detail}` : 'Connected'}</Badge>
                      ) : (
                        <Badge status="neutral">Not connected</Badge>
                      )}
                    </div>
                  </div>
                </Card>
              </a>
            ))}
          </section>
        ))}
      </div>
    </WorkspaceShell>
  );
}
