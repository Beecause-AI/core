'use client';

import { useEffect, useState } from 'react';
import { api, setGithubIssuesEnabled, type GithubConnection, type GithubEvents, type GithubMode, type OrgInfo } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Field, Input, Textarea } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationHero } from '../../../components/ui/integration-hero';

type Method = GithubMode;
const METHODS: { id: Method; label: string; blurb: string }[] = [
  { id: 'agent_app', label: 'Beecause Agent (recommended)', blurb: 'One-click install, per-repo access, no tokens to manage. GitHub.com only.' },
  { id: 'pat', label: 'Personal Access Token', blurb: 'Paste a token. Quick. GitHub.com or Enterprise. No event capture.' },
  { id: 'custom_app', label: 'Your own GitHub App', blurb: 'Bring your App credentials. Full control / Enterprise.' },
];
const EVENT_LABELS: { key: keyof GithubEvents; label: string; hint: string }[] = [
  { key: 'issues', label: 'Issues', hint: 'Issue lifecycle (opened, assigned, labeled, closed…) and issue comments.' },
  { key: 'pullRequests', label: 'Pull requests', hint: 'PR lifecycle, reviews, and PR comments.' },
  { key: 'branches', label: 'Branches & pushes', hint: 'Pushes and branch/tag create & delete.' },
];

export default function GithubPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [conn, setConn] = useState<GithubConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  // `editing` reveals the configure panel for an already-connected org so the
  // current connection can be reconfigured (re-paste a PAT, swap method, etc.).
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState<Method>('agent_app');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [pat, setPat] = useState({ token: '', baseUrl: '' });
  const [custom, setCustom] = useState({ appId: '', privateKey: '', installationId: '', webhookSecret: '', baseUrl: '' });

  const [repos, setRepos] = useState<string[] | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api<OrgInfo>('/api/org'), api<GithubConnection | null>('/api/github/connection')])
      .then(([o, c]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConn(c);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load GitHub integration');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search);
      if (q.get('error')) setError(`GitHub install failed: ${q.get('error')}`);
    }
  }, []);

  useEffect(() => {
    if (!conn) { setRepos(null); return; }
    api<{ repos: string[] }>('/api/github/connection/repos')
      .then((r) => setRepos(r.repos))
      .catch(() => setRepos([]));
  }, [conn?.mode, conn?.accountLabel]);

  function resetForm() {
    setPat({ token: '', baseUrl: '' });
    setCustom({ appId: '', privateKey: '', installationId: '', webhookSecret: '', baseUrl: '' });
    setFormError('');
  }

  function startEdit() {
    resetForm();
    setMethod(conn?.mode ?? 'agent_app');
    setEditing(true);
  }

  function cancelEdit() {
    resetForm();
    setEditing(false);
  }

  async function installAgent() {
    setBusy(true); setFormError('');
    try {
      const { url } = await api<{ url: string }>('/api/github/install-url', { method: 'POST' });
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
      const row = (await res.json()) as GithubConnection;
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
      const r = await api<{ ok: boolean; detail?: string }>('/api/github/connection/test', { method: 'POST' });
      setTestResult(r);
      setConn((c) => (c ? { ...c, lastTestOk: r.ok, lastTestedAt: new Date().toISOString() } : c));
    } catch (e) {
      setTestResult({ ok: false, detail: (e as { message?: string })?.message ?? 'Test failed' });
    } finally { setBusy(false); }
  }

  async function toggleEvent(key: keyof GithubEvents, value: boolean) {
    setBusy(true);
    try {
      const row = await api<GithubConnection>('/api/github/connection/events', { method: 'PATCH', body: JSON.stringify({ [key]: value }) });
      setConn(row);
    } catch (e) {
      setFormError((e as { message?: string })?.message ?? 'Failed to update events');
    } finally { setBusy(false); }
  }

  async function toggleIssues(value: boolean) {
    setBusy(true);
    try {
      await setGithubIssuesEnabled(value);
      setConn((c) => c && ({ ...c, metadata: { ...c.metadata, issuesEnabled: value } }));
    } catch (e) { setFormError((e as { message?: string })?.message ?? 'Failed to update'); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect GitHub? Stored credentials are removed. You may also need to uninstall the App on GitHub.')) return;
    setBusy(true);
    try {
      await api('/api/github/connection', { method: 'DELETE' });
      setConn(null); setRepos(null); setTestResult(null); setEditing(false); setMethod('agent_app');
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
          {method === 'agent_app' && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-fg-muted">
                You&apos;ll go to GitHub, pick which repositories the Agent can access, then come back here.
                Nothing is stored until you return.
              </p>
              <div className="flex items-center gap-2">
                <Button disabled={busy} onClick={() => void installAgent()}>{busy ? 'Starting…' : 'Install on GitHub →'}</Button>
                {onCancel && <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
              </div>
            </div>
          )}

          {method === 'pat' && (
            <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submitConfig('/api/github/connection/pat', { token: pat.token.trim(), ...(pat.baseUrl.trim() ? { baseUrl: pat.baseUrl.trim() } : {}) }); }}>
              <Field label="Personal access token">
                <Input type="password" autoComplete="off" required placeholder="ghp_… or github_pat_…"
                  value={pat.token} onChange={(e) => setPat((s) => ({ ...s, token: e.target.value }))} />
              </Field>
              <p className="text-xs text-fg-faint">Fine-grained token with Contents &amp; Metadata (read) is enough for connecting. Create one at github.com → Settings → Developer settings.</p>
              <Field label="Enterprise base URL (optional)">
                <Input type="url" autoComplete="off" placeholder="https://github.your-company.com"
                  value={pat.baseUrl} onChange={(e) => setPat((s) => ({ ...s, baseUrl: e.target.value }))} />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect & verify'}</Button>
                {onCancel && <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
              </div>
            </form>
          )}

          {method === 'custom_app' && (
            <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submitConfig('/api/github/connection/custom-app', { appId: custom.appId.trim(), privateKey: custom.privateKey, installationId: custom.installationId.trim(), ...(custom.webhookSecret.trim() ? { webhookSecret: custom.webhookSecret.trim() } : {}), ...(custom.baseUrl.trim() ? { baseUrl: custom.baseUrl.trim() } : {}) }); }}>
              <Field label="App ID"><Input required value={custom.appId} onChange={(e) => setCustom((s) => ({ ...s, appId: e.target.value }))} /></Field>
              <Field label="Installation ID"><Input required value={custom.installationId} onChange={(e) => setCustom((s) => ({ ...s, installationId: e.target.value }))} /></Field>
              <Field label="Private key (PEM)"><Textarea required rows={5} placeholder="-----BEGIN RSA PRIVATE KEY-----" value={custom.privateKey} onChange={(e) => setCustom((s) => ({ ...s, privateKey: e.target.value }))} /></Field>
              <Field label="Webhook secret (optional)"><Input type="password" autoComplete="off" value={custom.webhookSecret} onChange={(e) => setCustom((s) => ({ ...s, webhookSecret: e.target.value }))} /></Field>
              <p className="text-xs text-fg-faint">From your App&apos;s settings page. The webhook secret lets us verify event deliveries.</p>
              <Field label="Enterprise base URL (optional)"><Input type="url" autoComplete="off" placeholder="https://github.your-company.com" value={custom.baseUrl} onChange={(e) => setCustom((s) => ({ ...s, baseUrl: e.target.value }))} /></Field>
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

  if (loading) return <WorkspaceShell org={org}><PageHeader title="GitHub" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="GitHub" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the GitHub integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="GitHub" />
      <p className="mb-4 text-sm text-fg-muted">
        Connect GitHub once for the org. Projects then pick which repositories their assistants can read.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {conn ? (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-lg font-medium">Connected{conn.accountLabel ? ` as ${conn.accountLabel}` : ''}</span>
                <span className="text-sm text-fg-muted">
                  via {METHODS.find((m) => m.id === conn.mode)?.label ?? conn.mode}
                  {conn.baseUrl ? ` · ${conn.baseUrl}` : ''}
                </span>
              </div>
              <Badge status={conn.enabled ? (conn.lastTestOk === false ? 'crit' : 'ok') : 'neutral'}>
                {conn.enabled ? (conn.lastTestOk === false ? 'Error' : 'Active') : 'Disabled'}
              </Badge>
            </div>

            <div className="mt-4">
              <span className="text-xs uppercase tracking-wide text-fg-faint">Accessible repositories</span>
              {repos === null ? (
                <p className="mt-1 text-sm text-fg-faint">Loading…</p>
              ) : repos.length === 0 ? (
                <p className="mt-1 text-sm text-fg-faint">No repositories visible.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {repos.map((r) => <li key={r} className="font-mono text-sm text-fg-muted">{r}</li>)}
                </ul>
              )}
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

          <Card>
            <span className="text-lg font-medium">Event capture</span>
            <p className="mt-0.5 text-sm text-fg-muted">Stored for now, consumable later.</p>
            {conn.mode === 'pat' ? (
              <p className="mt-3 text-sm text-fg-faint">
                Event capture isn&apos;t available with a Personal Access Token — connect via the App for events.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {EVENT_LABELS.map(({ key, label, hint }) => {
                  const on = conn.metadata.events?.[key] ?? true;
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
            )}
          </Card>

          <Card>
            <span className="text-lg font-medium">GitHub issues</span>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium">GitHub issue creation</span>
                <span className="text-xs text-fg-faint">Let the Slack assistant offer to raise a GitHub issue after a fixable RCA. Enable per project too.</span>
              </div>
              <Button
                variant={conn.metadata.issuesEnabled ? 'secondary' : 'ghost'}
                disabled={busy}
                onClick={() => void toggleIssues(!conn.metadata.issuesEnabled)}
              >{conn.metadata.issuesEnabled ? 'On' : 'Off'}</Button>
            </div>
          </Card>
        </div>
      ) : (
        <IntegrationHero provider="github">
          <div className="mx-auto max-w-xl text-left">
            {configureForm()}
          </div>
        </IntegrationHero>
      )}
    </WorkspaceShell>
  );
}
