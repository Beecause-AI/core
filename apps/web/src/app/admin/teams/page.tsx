'use client';

import { useEffect, useState } from 'react';
import {
  api,
  getTeamsConnection,
  disconnectTeams,
  testTeams,
  listTeamsChannels,
  type TeamsConnection,
  type TeamsChannelBinding,
  type OrgInfo,
  type Project,
} from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationHero } from '../../../components/ui/integration-hero';

export default function TeamsPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [conn, setConn] = useState<TeamsConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  const [bindings, setBindings] = useState<TeamsChannelBinding[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  function loadChannels() {
    listTeamsChannels().then(setBindings).catch(() => setBindings([]));
    api<Project[]>('/api/org/projects').then(setProjects).catch(() => setProjects([]));
  }

  async function removeChannel(conversationId: string) {
    if (!window.confirm('Remove this channel? The project wired to it will lose access.')) return;
    setRemoving(conversationId);
    try {
      await api(`/api/teams/channels/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
      setBindings((bs) => bs.filter((b) => b.teamsConversationId !== conversationId));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to remove channel');
    } finally { setRemoving(null); }
  }

  useEffect(() => { if (conn) loadChannels(); }, [conn]); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    setLoading(true);
    Promise.all([api<OrgInfo>('/api/org'), getTeamsConnection()])
      .then(([o, c]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConn(c);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load Microsoft Teams integration');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function testConn() {
    setBusy(true); setTestResult(null);
    try {
      const r = await testTeams();
      setTestResult(r);
      setConn((c) => (c ? { ...c, lastTestOk: r.ok } : c));
    } catch (e) {
      setTestResult({ ok: false, detail: (e as { message?: string })?.message ?? 'Test failed' });
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Microsoft Teams? Stored credentials are removed. Channels already bound to projects will stop receiving messages.')) return;
    setBusy(true);
    try {
      await disconnectTeams();
      setConn(null); setTestResult(null);
    } catch (e) {
      setFormError((e as { message?: string })?.message ?? 'Failed to disconnect');
    } finally { setBusy(false); }
  }

  /** The "Add Beecause to Microsoft Teams" section — shown both in the
   *  IntegrationHero (not connected) and always visible once connected. */
  function installSection() {
    return (
      <Card>
        <span className="text-lg font-medium">Add Beecause to Microsoft Teams</span>
        <p className="mt-1 text-sm text-fg-muted">
          Download the app package, then upload it via the Teams admin center. Once installed,
          @-mention the bot in a channel to link it to a project.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <a href="/api/teams/manifest" download>
              <Button variant="secondary">Download app package (.zip)</Button>
            </a>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">Installation steps</span>
            <ol className="flex flex-col gap-2 text-sm text-fg-muted">
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-fg">1.</span>
                <span>
                  Go to{' '}
                  <a
                    href="https://admin.teams.microsoft.com/policies/manage-apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Teams admin center → Teams apps → Manage apps
                  </a>
                  .
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-fg">2.</span>
                <span>
                  Click <strong>Upload</strong> (or <strong>Upload new app</strong>) and select the
                  <code className="mx-1 rounded bg-raised px-1 py-0.5 font-mono text-xs">beecause-teams.zip</code>
                  you just downloaded.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-fg">3.</span>
                <span>
                  After Teams processes the package, find <strong>Beecause</strong> in the app list and
                  set its availability to your org (or the teams you want to use it in).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-medium text-fg">4.</span>
                <span>
                  In any channel, type{' '}
                  <code className="rounded bg-raised px-1 py-0.5 font-mono text-xs">@Beecause</code>{' '}
                  to mention the bot — this wires the channel here so you can assign it to a project.
                </span>
              </li>
            </ol>
          </div>

          <p className="text-xs text-fg-faint">
            Need to sideload first? Enable{' '}
            <a
              href="https://admin.teams.microsoft.com/policies/app-setup"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              custom-app upload
            </a>{' '}
            in your setup policy, then upload the package directly inside Teams (Apps → Manage your apps → Upload an app).
          </p>
        </div>
      </Card>
    );
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title="Microsoft Teams" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="Microsoft Teams" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the Microsoft Teams integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Microsoft Teams" />
      <p className="mb-4 text-sm text-fg-muted">
        Connect Microsoft Teams once for the org, then assign each channel to a project.
        @-Mentions in a channel are routed automatically by the project&apos;s incident response team.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {conn ? (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-lg font-medium">
                  Connected{conn.metadata?.tenantName ? ` · ${conn.metadata.tenantName}` : ''}
                </span>
                {conn.metadata?.tenantId && (
                  <span className="font-mono text-xs text-fg-faint">{conn.metadata.tenantId}</span>
                )}
              </div>
              <Badge status={conn.enabled ? (conn.lastTestOk === false ? 'crit' : 'ok') : 'neutral'}>
                {conn.enabled ? (conn.lastTestOk === false ? 'Error' : 'Active') : 'Disabled'}
              </Badge>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void testConn()}>Test</Button>
              <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button>
              {testResult && (
                <span className={testResult.ok ? 'text-sm text-ok' : 'text-sm text-crit'}>
                  {testResult.ok ? '✓ Connection valid' : `✗ ${testResult.detail ?? 'Test failed'}`}
                </span>
              )}
            </div>

            {formError && <p className="mt-3 text-sm text-crit">{formError}</p>}
          </Card>

          {installSection()}

          {/* ── Channels (read-only at org level; mapping is managed per project) ── */}
          <Card>
            <span className="text-lg font-medium">Channels</span>
            <p className="mt-1 text-sm text-fg-muted">
              Channels appear here once the bot is @-mentioned in them. Each is wired to a project
              from that project&apos;s Microsoft Teams settings — mentions are then handled by that
              project&apos;s team.
            </p>

            {bindings.length === 0 ? (
              <p className="mt-3 text-sm text-fg-faint">No channels yet. @-mention the bot in a channel to register it.</p>
            ) : (
              <div className="mt-4 divide-y divide-edge rounded-card border border-edge bg-surface">
                {bindings.map((b) => {
                  const project = projects.find((p) => p.id === b.projectId);
                  return (
                    <div key={b.teamsConversationId} className="flex items-center gap-3 px-5 py-3">
                      <span className="min-w-[10rem] flex-1 truncate font-mono text-sm text-fg">
                        {b.channelName ? b.channelName : b.teamsConversationId}
                      </span>
                      {b.projectId ? (
                        <span className="truncate text-sm text-fg-muted">{project?.name ?? 'Unknown project'}</span>
                      ) : (
                        <Badge status="neutral">Unassigned</Badge>
                      )}
                      <Button
                        variant="ghost"
                        disabled={removing === b.teamsConversationId}
                        onClick={() => void removeChannel(b.teamsConversationId)}
                      >
                        {removing === b.teamsConversationId ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <IntegrationHero provider="teams">
          <div className="w-full text-left">
            {installSection()}
          </div>
        </IntegrationHero>
      )}
    </WorkspaceShell>
  );
}
