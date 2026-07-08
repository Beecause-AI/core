'use client';

import { useEffect, useState } from 'react';
import { api, type OrgInfo, type ProjectDetail } from '../../lib/api';
import { parseProjectPath, type ProjectTab } from '../../lib/project-path';
import { WorkspaceShell } from '../../components/workspace-shell';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/ui/empty-state';
import { OverviewTab } from '../../components/project/overview-tab';
import { GithubReposPage } from '../../components/project/github-repos-page';
import { GitlabReposPage } from '../../components/project/gitlab-repos-page';
import { GcpTargetsPage } from '../../components/project/gcp-targets-page';
import { CloudflareTargetsPage } from '../../components/project/cloudflare-targets-page';
import { SentryTargetsPage } from '../../components/project/sentry-targets-page';
import { GrafanaTargetsPage } from '../../components/project/grafana-targets-page';
import { AwsTargetsPage } from '../../components/project/aws-targets-page';
import { AzureTargetsPage } from '../../components/project/azure-targets-page';
import { DatadogTargetsPage } from '../../components/project/datadog-targets-page';
import { DynatraceTargetsPage } from '../../components/project/dynatrace-targets-page';
import { PagerDutyTargetsPage } from '../../components/project/pagerduty-targets-page';
import { SlackChannelsPage } from '../../components/project/slack-channels-page';
import { TeamsChannelsPage } from '../../components/project/teams-channels-page';
import { KnowledgeGraphSection } from '../../components/project/knowledge-graph/kg-section';
import { IntegrationsTab } from '../../components/project/integrations-tab';
import { IntegrationDetail } from '../../components/project/integration-detail';
import { AssistantsTab } from '../../components/project/assistants-tab';
import { AssistantEditorPage } from '../../components/project/assistant-editor-page';
import { GenerationResultsPage } from '../../components/project/generation-results-page';
import { ConversationsTab } from '../../components/project/conversations-tab';
import { MembersTab } from '../../components/project/members-tab';
import { SettingsTab } from '../../components/project/settings-tab';
import { MemoryAdmin } from '../../components/project/memory-admin';
import { SkillsAdmin } from '../../components/project/skills-admin';

export default function ProjectPage() {
  const [parsed, setParsed] = useState<{ slug: string | null; tab: ProjectTab; sub: string | null; rest: string[] }>({
    slug: null,
    tab: 'overview',
    sub: null,
    rest: [],
  });
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const p = parseProjectPath(window.location.pathname);
    setParsed(p);
    if (!p.slug) {
      setLoading(false);
      return;
    }
    Promise.all([api<OrgInfo>('/api/org'), api<ProjectDetail>(`/api/org/projects/${p.slug}`)])
      .then(([o, pr]) => {
        setOrg(o);
        setProject(pr);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return; // api() redirects
        setError(
          e?.status === 404
            ? 'Project not found'
            : (e?.message ?? 'Failed to load project'),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  // Redirect legacy /team URLs to /assistants (tab was removed)
  useEffect(() => {
    if (typeof window === 'undefined' || !project?.slug) return;
    const p = window.location.pathname.replace(/\/+$/, '');
    if (p === `/p/${project.slug}/team`) window.location.replace(`/p/${project.slug}/assistants`);
  }, [project?.slug]);

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <Skeleton rows={4} variant="grid" />
      </WorkspaceShell>
    );
  }

  if (!parsed.slug) {
    return (
      <WorkspaceShell org={null}>
        <EmptyState title="No project selected" body="Pick a project from the sidebar." />
      </WorkspaceShell>
    );
  }

  if (error || !project) {
    return (
      <WorkspaceShell org={org}>
        <p className="text-sm text-crit">{error || 'Project not found'}</p>
      </WorkspaceShell>
    );
  }

  const isAdmin = project.myProjectRole === 'admin';

  return (
    <WorkspaceShell org={org} projectNav={{ slug: project.slug, name: project.name, activeTab: parsed.tab, isAdmin }}>
      {parsed.tab === 'overview' && <OverviewTab project={project} isAdmin={isAdmin} />}
      {parsed.tab === 'integrations' && (
        parsed.sub === 'github' ? (
          <IntegrationDetail slug={project.slug} provider="github" providerLabel="GitHub" scopeLabel="Repositories" isAdmin={isAdmin}>
            <GithubReposPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'gitlab' ? (
          <IntegrationDetail slug={project.slug} provider="gitlab" providerLabel="GitLab" scopeLabel="Repositories" isAdmin={isAdmin}>
            <GitlabReposPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'slack' ? (
          <IntegrationDetail slug={project.slug} provider="slack" providerLabel="Slack" scopeLabel="Channels" isAdmin={isAdmin}>
            <SlackChannelsPage slug={project.slug} isAdmin={isAdmin} />
          </IntegrationDetail>
        ) : parsed.sub === 'teams' ? (
          <IntegrationDetail slug={project.slug} provider="teams" providerLabel="Microsoft Teams" scopeLabel="Channels" isAdmin={isAdmin}>
            <TeamsChannelsPage slug={project.slug} isAdmin={isAdmin} />
          </IntegrationDetail>
        ) : parsed.sub === 'gcp' ? (
          <IntegrationDetail slug={project.slug} provider="gcp" providerLabel="Google Cloud observability" scopeLabel="Projects" isAdmin={isAdmin} readOnly>
            <GcpTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'cloudflare' ? (
          <IntegrationDetail slug={project.slug} provider="cloudflare" providerLabel="Cloudflare observability" scopeLabel="Cloudflare scope" isAdmin={isAdmin} readOnly>
            <CloudflareTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'sentry' ? (
          <IntegrationDetail slug={project.slug} provider="sentry" providerLabel="Sentry" scopeLabel="Sentry scope" isAdmin={isAdmin} readOnly>
            <SentryTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'grafana' ? (
          <IntegrationDetail slug={project.slug} provider="grafana" providerLabel="Grafana observability" scopeLabel="Datasources" isAdmin={isAdmin} readOnly>
            <GrafanaTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'aws' ? (
          <IntegrationDetail slug={project.slug} provider="aws" providerLabel="AWS observability" scopeLabel="Accounts & regions" isAdmin={isAdmin} readOnly>
            <AwsTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'azure' ? (
          <IntegrationDetail slug={project.slug} provider="azure" providerLabel="Azure observability" scopeLabel="Subscriptions & workspaces" isAdmin={isAdmin} readOnly>
            <AzureTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'datadog' ? (
          <IntegrationDetail slug={project.slug} provider="datadog" providerLabel="Datadog observability" scopeLabel="Environments & services" isAdmin={isAdmin} readOnly>
            <DatadogTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'dynatrace' ? (
          <IntegrationDetail slug={project.slug} provider="dynatrace" providerLabel="Dynatrace observability" scopeLabel="Management zones & services" isAdmin={isAdmin} readOnly>
            <DynatraceTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : parsed.sub === 'pagerduty' ? (
          <IntegrationDetail slug={project.slug} provider="pagerduty" providerLabel="PagerDuty observability" scopeLabel="Teams & services" isAdmin={isAdmin} readOnly>
            <PagerDutyTargetsPage slug={project.slug} />
          </IntegrationDetail>
        ) : <IntegrationsTab slug={project.slug} isAdmin={isAdmin} />
      )}
      {parsed.tab === 'knowledge-graph' && (
        org?.kgEnabled
          ? <KnowledgeGraphSection slug={project.slug} isAdmin={isAdmin} />
          : <EmptyState title="Knowledge Graph isn’t enabled" body="This feature isn’t enabled for your organisation." />
      )}
      {parsed.tab === 'assistants' && (
        parsed.sub === 'generation'
          ? <GenerationResultsPage slug={project.slug} />
          : parsed.sub
            ? (isAdmin
                ? <AssistantEditorPage slug={project.slug} assistantId={parsed.sub} />
                : <EmptyState title="Admins only" body="Only project admins can edit assistants." />)
            : <AssistantsTab slug={project.slug} isAdmin={isAdmin} />
      )}
      {parsed.tab === 'memory' && (isAdmin ? <MemoryAdmin slug={project.slug} /> : <EmptyState title="Admins only" body="Only project admins can manage team memory." />)}
      {parsed.tab === 'skills' && (isAdmin ? <SkillsAdmin slug={project.slug} /> : <EmptyState title="Admins only" body="Only project admins can manage skills." />)}
      {parsed.tab === 'conversations' && (
        parsed.sub
          ? <ConversationsTab slug={project.slug} conversationId={parsed.sub} />
          : <ConversationsTab slug={project.slug} />
      )}
      {parsed.tab === 'members' && (isAdmin ? <MembersTab slug={project.slug} /> : <EmptyState title="Admins only" body="Only project admins can manage members." />)}
      {parsed.tab === 'settings' && (isAdmin ? <SettingsTab project={project} /> : <EmptyState title="Admins only" body="Only project admins can change settings." />)}
    </WorkspaceShell>
  );
}
