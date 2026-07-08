'use client';

import { useEffect, useState } from 'react';
import { api, type OrgInfo, type Project } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationHero } from '../../../components/ui/integration-hero';

type Binding = {
  id: string;
  slackChannelId: string;
  channelName: string | null;
  projectId: string | null;
  status: 'pending' | 'bound';
};

type SlackConnection = {
  provider: 'slack';
  mode: 'oauth' | 'custom_app';
  accountLabel: string | null;
  enabled: boolean;
  lastTestOk: boolean | null;
  metadata?: { teamId?: string; teamName?: string; botUserId?: string };
};

const METHODS = [
  { id: 'oauth' as const, label: 'Add to Slack', blurb: 'Install the Beecause Slack app in your workspace.' },
  { id: 'custom_app' as const, label: 'Use your own Slack app', blurb: 'Bring your own bot token and signing secret.' },
];
type Method = (typeof METHODS)[number]['id'];

export default function SlackPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [conn, setConn] = useState<SlackConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  // `editing` reveals the configure panel for an already-connected org so the
  // current connection can be reconfigured (re-enter custom-app creds, reinstall).
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState<Method>('oauth');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [custom, setCustom] = useState({ botToken: '', signingSecret: '' });

  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  // Channels section — read-only at org level; the channel→project→assistant
  // mapping is managed in each project's Slack integration settings.
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  function loadChannels() {
    api<Binding[]>('/api/slack/channels').then(setBindings).catch(() => setBindings([]));
    api<Project[]>('/api/org/projects').then(setProjects).catch(() => setProjects([]));
  }

  async function unbind(channelId: string) {
    if (!window.confirm('Remove this channel? The project wired to it will lose access.')) return;
    setRemoving(channelId);
    try {
      await api(`/api/slack/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
      setBindings((bs) => bs.filter((b) => b.slackChannelId !== channelId));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to remove channel');
    } finally { setRemoving(null); }
  }

  useEffect(() => { if (conn) loadChannels(); }, [conn]); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    setLoading(true);
    Promise.all([api<OrgInfo>('/api/org'), api<SlackConnection | null>('/api/slack/connection')])
      .then(([o, c]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConn(c);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load Slack integration');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search);
      if (q.get('error')) setError(`Slack install failed: ${q.get('error')}`);
    }
  }, []);

  function resetForm() {
    setCustom({ botToken: '', signingSecret: '' });
    setFormError('');
  }

  function startEdit() {
    resetForm();
    setMethod(conn?.mode ?? 'oauth');
    setEditing(true);
  }

  function cancelEdit() {
    resetForm();
    setEditing(false);
  }

  async function installSlack() {
    setBusy(true); setFormError('');
    try {
      const { url } = await api<{ url: string }>('/api/slack/install-url', { method: 'POST' });
      window.location.assign(url);
    } catch (e) {
      setBusy(false);
      setFormError((e as { message?: string })?.message ?? 'Could not start the install');
    }
  }

  async function submitConfig(path: string, body: object) {
    setBusy(true); setFormError('');
    try {
      const res = await fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const eb = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        setFormError([eb.error ?? 'Failed to connect', eb.detail].filter(Boolean).join(': '));
        setBusy(false);
        return;
      }
      const row = (await res.json()) as SlackConnection;
      setConn(row);
      resetForm();
      setEditing(false);
      setBusy(false);
    } catch {
      setFormError('Failed to connect'); setBusy(false);
    }
  }

  async function testConn() {
    setBusy(true); setTestResult(null);
    try {
      const r = await api<{ ok: boolean; detail?: string }>('/api/slack/connection/test', { method: 'POST' });
      setTestResult(r);
      setConn((c) => (c ? { ...c, lastTestOk: r.ok } : c));
    } catch (e) {
      setTestResult({ ok: false, detail: (e as { message?: string })?.message ?? 'Test failed' });
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Slack? Stored credentials are removed. You may also need to uninstall the app from your Slack workspace.')) return;
    setBusy(true);
    try {
      await api('/api/slack/connection', { method: 'DELETE' });
      setConn(null); setTestResult(null); setEditing(false); setMethod('oauth');
    } catch (e) {
      setFormError((e as { message?: string })?.message ?? 'Failed to disconnect');
    } finally { setBusy(false); }
  }

  // The method picker + per-method configure form. Shared by the first-time Add
  // flow and the Edit panel; `onCancel` (Edit only) renders a Cancel button.
  function configureForm(onCancel?: () => void) {
    return (
      <>
        <Card>
          <span className="text-lg font-medium">How do you want to connect?</span>
          <div className="mt-3 flex flex-col gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setMethod(m.id); setFormError(''); }}
                className={`rounded-lg border p-3 text-left ${method === m.id ? 'border-accent bg-accent/5' : 'border-edge'}`}
                data-selected={method === m.id}
              >
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-sm text-fg-muted">{m.blurb}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <span className="text-lg font-medium">Configure</span>
          {method === 'oauth' && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-fg-muted">
                You&apos;ll go to Slack, authorise the Beecause app in your workspace, then come back here.
                Nothing is stored until you return.
              </p>
              <div className="flex items-center gap-2">
                <Button disabled={busy} onClick={() => void installSlack()}>{busy ? 'Starting…' : 'Add to Slack →'}</Button>
                {onCancel && <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
              </div>
            </div>
          )}

          {method === 'custom_app' && (
            <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submitConfig('/api/slack/connection/custom-app', { botToken: custom.botToken.trim(), signingSecret: custom.signingSecret.trim() }); }}>
              <Field label="Bot token">
                <Input type="password" autoComplete="off" required placeholder="xoxb-…"
                  value={custom.botToken} onChange={(e) => setCustom((s) => ({ ...s, botToken: e.target.value }))} />
              </Field>
              <Field label="Signing secret">
                <Input type="password" autoComplete="off" required placeholder="Slack app signing secret"
                  value={custom.signingSecret} onChange={(e) => setCustom((s) => ({ ...s, signingSecret: e.target.value }))} />
              </Field>
              <p className="text-xs text-fg-faint">Find these in your Slack app&apos;s Basic Information page under &quot;App Credentials&quot;.</p>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect & verify'}</Button>
                {onCancel && <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
              </div>
            </form>
          )}

          {formError && <p className="mt-3 text-sm text-crit">{formError}</p>}
        </Card>
      </>
    );
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title="Slack" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="Slack" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the Slack integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Slack" />
      <p className="mb-4 text-sm text-fg-muted">
        Connect Slack once for the org, then assign each channel to a project. Mentions are routed
        automatically by the project’s incident response team — no per-channel assistant to pick.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {conn ? (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-lg font-medium">Connected{conn.accountLabel ? ` · ${conn.accountLabel}` : ''}</span>
                <span className="text-sm text-fg-muted">
                  via {METHODS.find((m) => m.id === conn.mode)?.label ?? conn.mode}
                </span>
              </div>
              <Badge status={conn.enabled ? (conn.lastTestOk === false ? 'crit' : 'ok') : 'neutral'}>
                {conn.enabled ? (conn.lastTestOk === false ? 'Error' : 'Active') : 'Disabled'}
              </Badge>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={busy || editing} onClick={startEdit}>Edit</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void testConn()}>Test</Button>
              <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button>
              {testResult && (
                <span className={testResult.ok ? 'text-sm text-ok' : 'text-sm text-crit'}>
                  {testResult.ok ? '✓ Connection valid' : `✗ ${testResult.detail ?? 'Test failed'}`}
                </span>
              )}
            </div>
          </Card>

          {editing && configureForm(cancelEdit)}

          {formError && !editing && <p className="text-sm text-crit">{formError}</p>}

          {/* ── Channels (read-only; mapping is managed per project) ── */}
          <Card>
            <span className="text-lg font-medium">Channels</span>
            <p className="mt-1 text-sm text-fg-muted">
              Channels show up here once the bot is mentioned in them. Each is wired to a project
              from that project’s Slack settings — mentions are then handled by that project’s team.
            </p>

            {bindings.length === 0 ? (
              <p className="mt-3 text-sm text-fg-faint">No channels yet. Invite the bot to a channel and mention it.</p>
            ) : (
              <div className="mt-4 divide-y divide-edge rounded-card border border-edge bg-surface">
                {bindings.map((b) => {
                  const project = projects.find((p) => p.id === b.projectId);
                  return (
                    <div key={b.slackChannelId} className="flex items-center gap-3 px-5 py-3">
                      <span className="min-w-[10rem] flex-1 truncate font-mono text-sm text-fg">
                        {b.channelName ? `#${b.channelName}` : b.slackChannelId}
                      </span>
                      {b.projectId ? (
                        <span className="truncate text-sm text-fg-muted">{project?.name ?? 'Unknown project'}</span>
                      ) : (
                        <Badge status="neutral">Unassigned</Badge>
                      )}
                      <Button
                        variant="ghost"
                        disabled={removing === b.slackChannelId}
                        onClick={() => void unbind(b.slackChannelId)}
                      >
                        {removing === b.slackChannelId ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <IntegrationHero provider="slack">
          <div className="mx-auto max-w-xl text-left">
            {configureForm()}
          </div>
        </IntegrationHero>
      )}
    </WorkspaceShell>
  );
}
