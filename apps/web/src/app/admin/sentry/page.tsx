'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type SentryConnection, type OrgInfo } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { Input, Field } from '../../../components/ui/input';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationHero } from '../../../components/ui/integration-hero';

type PanelState = { kind: 'edit'; id: string } | null;

export default function SentryPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [connections, setConnections] = useState<SentryConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  const [panel, setPanel] = useState<PanelState>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [sentryOrgSlug, setSentryOrgSlug] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api<OrgInfo>('/api/org'),
      api<{ connections: SentryConnection[] }>('/api/integrations/sentry/connections'),
    ])
      .then(([o, res]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConnections(res.connections);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load Sentry connections');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setName('');
    setSentryOrgSlug('');
    setBaseUrl('');
    setAuthToken('');
    setFormError('');
  }

  function openEdit(c: SentryConnection) {
    resetForm();
    setName(c.name);
    setSentryOrgSlug(c.metadata.sentryOrgSlug ?? '');
    setBaseUrl(c.baseUrl);
    setPanel({ kind: 'edit', id: c.id });
  }

  function closePanel() {
    setPanel(null);
    resetForm();
  }

  const canSave = !!name.trim();

  async function save() {
    if (!panel) return;
    setFormError('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (sentryOrgSlug.trim()) body.sentryOrgSlug = sentryOrgSlug.trim();
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (authToken.trim()) body.authToken = authToken.trim();
      const res = await fetch(`/api/integrations/sentry/connections/${panel.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to update connection'); return;
      }
      const { connection } = (await res.json()) as { connection: SentryConnection };
      setConnections((prev) => prev.map((c) => (c.id === connection.id ? connection : c)));
      closePanel();
    } catch {
      setFormError('Failed to save connection');
    } finally { setBusy(false); }
  }

  async function test(c: SentryConnection) {
    setTestingId(c.id);
    setTestErrors((prev) => ({ ...prev, [c.id]: '' }));
    try {
      const res = await fetch(`/api/integrations/sentry/connections/${c.id}/test`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setTestErrors((prev) => ({ ...prev, [c.id]: e.error ?? 'Test failed' }));
        setConnections((prev) => prev.map((x) => (x.id === c.id ? { ...x, lastTestOk: false, lastTestedAt: new Date().toISOString() } : x)));
        return;
      }
      setConnections((prev) => prev.map((x) => (x.id === c.id ? { ...x, lastTestOk: true, lastTestedAt: new Date().toISOString() } : x)));
    } catch {
      setTestErrors((prev) => ({ ...prev, [c.id]: 'Test failed' }));
    } finally { setTestingId(null); }
  }

  async function remove(c: SentryConnection) {
    if (!window.confirm('Remove this connection? Project scopes that use it will stop working.')) return;
    setRemovingId(c.id);
    setError('');
    try {
      await api(`/api/integrations/sentry/connections/${c.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      if (panel?.kind === 'edit' && panel.id === c.id) closePanel();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to remove connection');
    } finally { setRemovingId(null); }
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title="Sentry" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="Sentry" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the Sentry integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Sentry" actions={<Button onClick={() => router.push('/admin/sentry/new')}>Add connection</Button>} />
      <p className="mb-4 text-sm text-fg-muted">
        Reusable read-only credentials. Projects pick a connection and scope it to specific Sentry projects.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {panel && (
        <Card className="mb-4">
          <span className="text-lg font-medium">Edit connection</span>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Sentry organization slug">
              <Input className="font-mono" value={sentryOrgSlug} placeholder="acme" onChange={(e) => setSentryOrgSlug(e.target.value)} />
            </Field>
            <Field label="Base URL">
              <Input className="font-mono" value={baseUrl} placeholder="https://sentry.io" onChange={(e) => setBaseUrl(e.target.value)} />
            </Field>
            <Field label="Auth token">
              <Input type="password" value={authToken} placeholder="Leave blank to keep the current token" onChange={(e) => setAuthToken(e.target.value)} />
            </Field>
            <div className="flex items-center gap-2">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button variant="ghost" disabled={busy} onClick={closePanel}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
      )}

      {connections.length === 0 ? (
        !panel && (
          <IntegrationHero provider="sentry">
            <div className="flex justify-center">
              <Button onClick={() => router.push('/admin/sentry/new')}>Add connection</Button>
            </div>
          </IntegrationHero>
        )
      ) : (
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          {connections.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="text-fg">{c.name}</span>
                <Badge status={c.enabled ? (c.lastTestOk === false ? 'crit' : 'ok') : 'neutral'}>
                  {c.enabled ? (c.lastTestOk === false ? 'Error' : 'Active') : 'Disabled'}
                </Badge>
                {c.metadata.sentryOrgSlug && (
                  <span className="font-mono text-xs text-fg-faint">{c.metadata.sentryOrgSlug}</span>
                )}
                {c.baseUrl !== 'https://sentry.io' && (
                  <span className="font-mono text-xs text-fg-faint">{c.baseUrl}</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
                  <Button variant="ghost" disabled={testingId === c.id} onClick={() => void test(c)}>
                    {testingId === c.id ? 'Testing…' : 'Test'}
                  </Button>
                  <Button variant="ghost" disabled={removingId === c.id} onClick={() => void remove(c)}>
                    {removingId === c.id ? 'Removing…' : 'Remove'}
                  </Button>
                </div>
              </div>
              {c.lastTestedAt && (
                <p className="text-xs text-fg-faint">
                  Checked {new Date(c.lastTestedAt).toLocaleString()} · {c.lastTestOk === false ? 'Failed' : 'OK'}
                </p>
              )}
              {testErrors[c.id] && <p className="text-sm text-crit">{testErrors[c.id]}</p>}
            </div>
          ))}
        </div>
      )}
    </WorkspaceShell>
  );
}
