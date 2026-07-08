'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type DatadogConnection, type DatadogSignal, type DatadogSignalReport, type OrgInfo } from '../../../lib/api';
import type { DatadogSite } from '../../../lib/api';
import { DatadogCredsForm } from '../../../components/project/datadog-creds-form';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { Input, Field } from '../../../components/ui/input';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationHero } from '../../../components/ui/integration-hero';
import { SignalPills, type SignalSection } from '../../../components/ui/signal-pills';
import { SignalReportModal } from '../../../components/ui/signal-report-modal';

type PanelState = { kind: 'edit'; id: string } | null;

const SIGNALS: DatadogSignal[] = ['metrics', 'logs', 'traces', 'alerts'];
const DATADOG_SECTIONS: SignalSection[] = [
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'traces', label: 'Traces' },
  { key: 'alerts', label: 'Alerts' },
];

export default function DatadogPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [connections, setConnections] = useState<DatadogConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  const [panel, setPanel] = useState<PanelState>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, DatadogSignalReport>>({});
  const [reportModalId, setReportModalId] = useState<string | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [site, setSite] = useState<DatadogSite>('us1');
  const [apiKey, setApiKey] = useState('');
  const [appKey, setAppKey] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api<OrgInfo>('/api/org'),
      api<{ connections: DatadogConnection[] }>('/api/integrations/datadog/connections'),
    ])
      .then(([o, res]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConnections(res.connections);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load Datadog connections');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setName('');
    setSite('us1');
    setApiKey('');
    setAppKey('');
    setFormError('');
  }

  function openAdd() {
    router.push('/admin/datadog/new');
  }

  function openEdit(c: DatadogConnection) {
    resetForm();
    setName(c.name);
    setSite(c.site);
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
      const body: Record<string, unknown> = { name: name.trim(), site };
      if (apiKey.trim()) body.apiKey = apiKey;
      if (appKey.trim()) body.appKey = appKey;
      const res = await fetch(`/api/integrations/datadog/connections/${panel.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to update connection'); return;
      }
      const { connection } = (await res.json()) as { connection: DatadogConnection };
      setConnections((prev) => prev.map((c) => (c.id === connection.id ? connection : c)));
      closePanel();
    } catch {
      setFormError('Failed to save connection');
    } finally { setBusy(false); }
  }

  async function verify(c: DatadogConnection) {
    setVerifyingId(c.id);
    setVerifyErrors((prev) => ({ ...prev, [c.id]: '' }));
    setReports((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
    try {
      const res = await fetch(`/api/integrations/datadog/connections/${c.id}/verify`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setVerifyErrors((prev) => ({ ...prev, [c.id]: e.error ?? 'Verification failed' }));
        return;
      }
      const { report } = (await res.json()) as { report: DatadogSignalReport; availableSignals: string[] };
      setReports((prev) => ({ ...prev, [c.id]: report }));
      setReportModalId(c.id);
      const avail = SIGNALS.filter((s) => report[s]?.ok);
      setConnections((prev) => prev.map((x) => (x.id === c.id
        ? { ...x, lastTestOk: avail.length > 0, lastTestedAt: new Date().toISOString(), metadata: { ...x.metadata, availableSignals: avail } }
        : x)));
    } catch {
      setVerifyErrors((prev) => ({ ...prev, [c.id]: 'Verification failed' }));
    } finally { setVerifyingId(null); }
  }

  async function remove(c: DatadogConnection) {
    if (!window.confirm('Remove this connection? Project scopes that use it will stop working.')) return;
    setRemovingId(c.id);
    setError('');
    try {
      await api(`/api/integrations/datadog/connections/${c.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      if (panel?.kind === 'edit' && panel.id === c.id) closePanel();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to remove connection');
    } finally { setRemovingId(null); }
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title="Datadog" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="Datadog" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the Datadog integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Datadog" actions={<Button onClick={openAdd}>Add connection</Button>} />
      <p className="mb-4 text-sm text-fg-muted">
        Reusable read-only credentials. Projects pick a connection and scope it to specific environments and services.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {panel && (
        <Card className="mb-4">
          <span className="text-lg font-medium">Edit connection</span>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} />
            </Field>
            <DatadogCredsForm
              site={site}
              onSiteChange={setSite}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              appKey={appKey}
              onAppKeyChange={setAppKey}
              editing
            />
            <p className="text-xs text-fg-faint">Leave key fields blank to keep the current secrets.</p>
            <div className="flex items-center gap-2">
              <Button disabled={busy || !canSave} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={closePanel}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
      )}

      {connections.length === 0 ? (
        !panel && (
          <IntegrationHero provider="datadog">
            <div className="flex justify-center">
              <Button onClick={openAdd}>Add connection</Button>
            </div>
          </IntegrationHero>
        )
      ) : (
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          {connections.map((c) => {
            const report = reports[c.id];
            const verr = verifyErrors[c.id];
            return (
              <div key={c.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-fg">{c.name}</span>
                  <Badge>{c.site}</Badge>
                  <Badge status={c.enabled ? (c.lastTestOk === false ? 'crit' : 'ok') : 'neutral'}>
                    {c.enabled ? (c.lastTestOk === false ? 'Error' : 'Active') : 'Disabled'}
                  </Badge>
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
                    <Button variant="ghost" disabled={verifyingId === c.id} onClick={() => void verify(c)}>
                      {verifyingId === c.id ? 'Verifying…' : 'Verify'}
                    </Button>
                    {reports[c.id] && (
                      <Button variant="ghost" onClick={() => setReportModalId(c.id)}>View report</Button>
                    )}
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
                {verr && <p className="text-sm text-crit">{verr}</p>}
                <SignalPills
                  sections={DATADOG_SECTIONS}
                  available={c.metadata.availableSignals}
                  checked={!!c.lastTestedAt}
                  errors={report ? Object.fromEntries(SIGNALS.map((s) => [s, report[s]?.error])) : undefined}
                />
              </div>
            );
          })}
        </div>
      )}

      <SignalReportModal
        open={reportModalId !== null}
        onClose={() => setReportModalId(null)}
        title={`${connections.find((c) => c.id === reportModalId)?.name ?? 'Connection'} — verification report`}
        sections={DATADOG_SECTIONS}
        report={reportModalId ? reports[reportModalId] ?? null : null}
        checkedAt={connections.find((c) => c.id === reportModalId)?.lastTestedAt}
      />
    </WorkspaceShell>
  );
}
