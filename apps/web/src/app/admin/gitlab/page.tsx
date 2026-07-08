'use client';

import { useEffect, useState } from 'react';
import {
  getGitlabConnection,
  saveGitlabToken,
  testGitlabConnection,
  getGitlabWebhook,
  setGitlabEvents,
  setGitlabIssuesEnabled,
  deleteGitlabConnection,
  api,
  type GitlabConnection,
  type GitlabEvents,
  type OrgInfo,
} from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationHero } from '../../../components/ui/integration-hero';

const EVENT_LABELS: { key: keyof GitlabEvents; label: string; hint: string }[] = [
  { key: 'push', label: 'Push events', hint: 'Branch pushes and tag create/delete.' },
  { key: 'issues', label: 'Issues', hint: 'Issue lifecycle (opened, updated, closed…) and comments.' },
  { key: 'mergeRequests', label: 'Merge requests', hint: 'MR lifecycle, reviews, and MR comments.' },
];

export default function GitlabPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [conn, setConn] = useState<GitlabConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Token form fields (used when not connected)
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  // Test result
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string; repoCount?: number | null } | null>(null);

  // Webhook data
  const [webhook, setWebhook] = useState<{ url: string; secret: string | null } | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api<OrgInfo>('/api/org'), getGitlabConnection()])
      .then(([o, c]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConn(c);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load GitLab integration');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  // Load webhook when connected
  useEffect(() => {
    if (!conn) { setWebhook(null); return; }
    setWebhookLoading(true);
    getGitlabWebhook()
      .then(setWebhook)
      .catch(() => setWebhook(null))
      .finally(() => setWebhookLoading(false));
  }, [conn?.mode, conn?.accountLabel]);

  function resetForm() {
    setToken('');
    setBaseUrl('');
    setFormError('');
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError('');
    try {
      const row = await saveGitlabToken({
        token: token.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      });
      setConn(row);
      resetForm();
    } catch (err) {
      setFormError((err as { message?: string })?.message ?? 'Failed to connect');
    } finally { setBusy(false); }
  }

  async function testConn() {
    setBusy(true); setTestResult(null);
    try {
      const r = await testGitlabConnection();
      setTestResult(r);
      setConn((c) => (c ? { ...c, lastTestOk: r.ok, lastTestedAt: new Date().toISOString() } : c));
    } catch (err) {
      setTestResult({ ok: false, detail: (err as { message?: string })?.message ?? 'Test failed' });
    } finally { setBusy(false); }
  }

  async function toggleEvent(key: keyof GitlabEvents, value: boolean) {
    setBusy(true);
    try {
      const row = await setGitlabEvents({ [key]: value });
      setConn(row);
    } catch (err) {
      setFormError((err as { message?: string })?.message ?? 'Failed to update events');
    } finally { setBusy(false); }
  }

  async function toggleIssues(value: boolean) {
    setBusy(true);
    try {
      await setGitlabIssuesEnabled(value);
      setConn((c) => c && ({ ...c, metadata: { ...c.metadata, issuesEnabled: value } }));
    } catch (err) {
      setFormError((err as { message?: string })?.message ?? 'Failed to update');
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect GitLab? Stored credentials and webhook configuration are removed.')) return;
    setBusy(true);
    try {
      await deleteGitlabConnection();
      setConn(null); setTestResult(null); setWebhook(null); resetForm();
    } catch (err) {
      setFormError((err as { message?: string })?.message ?? 'Failed to disconnect');
    } finally { setBusy(false); }
  }

  async function copyToClipboard(text: string, field: 'url' | 'secret') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title="GitLab" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="GitLab" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the GitLab integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="GitLab" />
      <p className="mb-4 text-sm text-fg-muted">
        Connect GitLab once for the org. Projects then pick which repositories their assistants can read.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {conn ? (
        <div className="flex flex-col gap-4">
          {/* Status card */}
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-lg font-medium">
                  Connected{conn.accountLabel ? ` as ${conn.accountLabel}` : ''}
                </span>
                <span className="text-sm text-fg-muted">
                  {conn.baseUrl ?? 'https://gitlab.com'}
                  {conn.secretHint ? ` · token ${conn.secretHint}` : ''}
                </span>
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
                  {testResult.ok
                    ? `✓ ${[testResult.detail ?? 'Connection valid', testResult.repoCount != null ? `${testResult.repoCount} repo${testResult.repoCount === 1 ? '' : 's'} visible` : null].filter(Boolean).join(' · ')}`
                    : `✗ ${testResult.detail ?? 'Test failed'}`}
                </span>
              )}
            </div>
            {formError && <p className="mt-3 text-sm text-crit">{formError}</p>}
          </Card>

          {/* Event toggles */}
          <Card>
            <span className="text-lg font-medium">Event capture</span>
            <p className="mt-0.5 text-sm text-fg-muted">Choose which GitLab events are captured for assistants to use during RCA.</p>
            <div className="mt-3 flex flex-col gap-3">
              {EVENT_LABELS.map(({ key, label, hint }) => {
                const on = conn.metadata.gitlabEvents?.[key] ?? true;
                return (
                  <div key={key} className="flex items-start justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-xs text-fg-faint">{hint}</span>
                    </div>
                    <Button variant={on ? 'secondary' : 'ghost'} disabled={busy} onClick={() => void toggleEvent(key, !on)}>
                      {on ? 'On' : 'Off'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Issue creation toggle */}
          <Card>
            <span className="text-lg font-medium">GitLab issues</span>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium">GitLab issue creation</span>
                <span className="text-xs text-fg-faint">Let the Slack assistant offer to raise a GitLab issue after a fixable RCA. Enable per project too.</span>
              </div>
              <Button
                variant={conn.metadata.issuesEnabled ? 'secondary' : 'ghost'}
                disabled={busy}
                onClick={() => void toggleIssues(!conn.metadata.issuesEnabled)}
              >{conn.metadata.issuesEnabled ? 'On' : 'Off'}</Button>
            </div>
          </Card>

          {/* Webhook setup card */}
          <Card>
            <span className="text-lg font-medium">Webhook setup</span>
            <p className="mt-0.5 text-sm text-fg-muted">
              Configure a webhook in GitLab to forward push, issue, and merge request events to Beecause.
            </p>
            {webhookLoading ? (
              <Skeleton rows={2} />
            ) : webhook ? (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-fg-faint">Webhook URL</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md border border-edge bg-raised px-3 py-2 font-mono text-sm text-fg-muted break-all">
                      {webhook.url}
                    </code>
                    <Button
                      variant="ghost"
                      onClick={() => void copyToClipboard(webhook.url, 'url')}
                    >
                      {copied === 'url' ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                </div>

                {webhook.secret && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-fg-faint">Secret token</span>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md border border-edge bg-raised px-3 py-2 font-mono text-sm text-fg-muted break-all">
                        {webhook.secret}
                      </code>
                      <Button
                        variant="ghost"
                        onClick={() => void copyToClipboard(webhook.secret!, 'secret')}
                      >
                        {copied === 'secret' ? 'Copied!' : 'Copy'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-edge bg-raised px-4 py-3">
                  <p className="text-sm font-medium text-fg">How to configure in GitLab</p>
                  <ol className="mt-2 flex flex-col gap-1 text-sm text-fg-muted list-decimal list-inside">
                    <li>Go to your group or project → <span className="font-medium">Settings → Webhooks</span></li>
                    <li>Paste the Webhook URL above into the <span className="font-mono text-xs bg-raised border border-edge rounded px-1">URL</span> field</li>
                    <li>Paste the Secret token into the <span className="font-mono text-xs bg-raised border border-edge rounded px-1">Secret token</span> field</li>
                    <li>Enable <span className="font-medium">Push events</span>, <span className="font-medium">Issues events</span>, and <span className="font-medium">Merge request events</span></li>
                    <li>Click <span className="font-medium">Add webhook</span></li>
                  </ol>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-fg-faint">Webhook configuration unavailable.</p>
            )}
          </Card>
        </div>
      ) : (
        <IntegrationHero provider="gitlab">
          <Card>
              <span className="text-lg font-medium">Connect with an access token</span>
              <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => void connect(e)}>
                <Field label="Personal access token">
                  <Input
                    type="password"
                    autoComplete="off"
                    required
                    placeholder="glpat-…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </Field>
                <p className="text-xs text-fg-faint">
                  Create a token at GitLab → User Settings → Access Tokens (or a group/project token).
                  Needs <span className="font-mono">read_api</span> scope at minimum.
                </p>
                <Field label="GitLab base URL (optional)">
                  <Input
                    type="url"
                    autoComplete="off"
                    placeholder="https://gitlab.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </Field>
                <p className="text-xs text-fg-faint">Leave blank for gitlab.com. Set to your self-managed instance URL if needed.</p>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect & verify'}</Button>
                </div>
                {formError && <p className="text-sm text-crit">{formError}</p>}
              </form>
            </Card>
        </IntegrationHero>
      )}
    </WorkspaceShell>
  );
}
