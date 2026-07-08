'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type AwsConnection, type AwsMode, type AwsSignal, type AwsSignalReport, type OrgInfo } from '../../../lib/api';
import { AwsCredsForm } from '../../../components/project/aws-creds-form';
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

const SIGNALS: AwsSignal[] = ['metrics', 'logs', 'traces', 'alarms'];
const AWS_SECTIONS: SignalSection[] = [
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'traces', label: 'Traces' },
  { key: 'alarms', label: 'Alarms' },
];

export default function AwsPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [connections, setConnections] = useState<AwsConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');

  const [panel, setPanel] = useState<PanelState>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, AwsSignalReport>>({});
  const [reportModalId, setReportModalId] = useState<string | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [mode, setMode] = useState<AwsMode>('assume_role');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [defaultRegion, setDefaultRegion] = useState('us-east-1');

  function load() {
    setLoading(true);
    Promise.all([
      api<OrgInfo>('/api/org'),
      api<{ connections: AwsConnection[] }>('/api/integrations/aws/connections'),
    ])
      .then(([o, res]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setConnections(res.connections);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load AWS connections');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setName('');
    setMode('assume_role');
    setAccessKeyId('');
    setSecretAccessKey('');
    setRoleArn('');
    setDefaultRegion('us-east-1');
    setFormError('');
  }

  function openAdd() {
    router.push('/admin/aws/new');
  }

  function openEdit(c: AwsConnection) {
    resetForm();
    setName(c.name);
    setMode(c.mode);
    setDefaultRegion(c.defaultRegion);
    if (c.roleArn) setRoleArn(c.roleArn);
    setPanel({ kind: 'edit', id: c.id });
  }

  function closePanel() {
    setPanel(null);
    resetForm();
  }

  const canSave = !!name.trim() && !!defaultRegion;

  function credsBody() {
    return mode === 'access_key' ? { mode, accessKeyId, secretAccessKey } : { mode, roleArn };
  }

  async function save() {
    if (!panel) return;
    setFormError('');
    setBusy(true);
    try {
      const body = { name: name.trim(), defaultRegion, ...credsBody() };
      const res = await fetch(`/api/integrations/aws/connections/${panel.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to update connection'); return;
      }
      const { connection } = (await res.json()) as { connection: AwsConnection };
      setConnections((prev) => prev.map((c) => (c.id === connection.id ? connection : c)));
      closePanel();
    } catch {
      setFormError('Failed to save connection');
    } finally { setBusy(false); }
  }

  async function verify(c: AwsConnection) {
    setVerifyingId(c.id);
    setVerifyErrors((prev) => ({ ...prev, [c.id]: '' }));
    setReports((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
    try {
      const res = await fetch(`/api/integrations/aws/connections/${c.id}/verify`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setVerifyErrors((prev) => ({ ...prev, [c.id]: e.error ?? 'Verification failed' }));
        return;
      }
      const { report } = (await res.json()) as { report: AwsSignalReport; availableSignals: string[] };
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

  async function remove(c: AwsConnection) {
    if (!window.confirm('Remove this connection? Project scopes that use it will stop working.')) return;
    setRemovingId(c.id);
    setError('');
    try {
      await api(`/api/integrations/aws/connections/${c.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      if (panel?.kind === 'edit' && panel.id === c.id) closePanel();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to remove connection');
    } finally { setRemovingId(null); }
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title="AWS" /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title="AWS" />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the AWS integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="AWS" actions={<Button onClick={openAdd}>Add connection</Button>} />
      <p className="mb-4 text-sm text-fg-muted">
        Reusable read-only credentials. Projects pick a connection and scope it to specific AWS accounts.
      </p>
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}

      {panel && (
        <Card className="mb-4">
          <span className="text-lg font-medium">Edit connection</span>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production account" onChange={(e) => setName(e.target.value)} />
            </Field>
            <AwsCredsForm
              mode={mode}
              onModeChange={setMode}
              accessKeyId={accessKeyId}
              onAccessKeyIdChange={setAccessKeyId}
              secretAccessKey={secretAccessKey}
              onSecretAccessKeyChange={setSecretAccessKey}
              roleArn={roleArn}
              onRoleArnChange={setRoleArn}
              defaultRegion={defaultRegion}
              onDefaultRegionChange={setDefaultRegion}
              externalId={connections.find((c) => c.id === panel?.id)?.externalId}
              editing
            />
            <p className="text-xs text-fg-faint">Leave credentials blank to keep the current secret.</p>
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
          <IntegrationHero provider="aws">
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
                  <Badge>{c.mode === 'assume_role' ? 'IAM role' : 'Access key'}</Badge>
                  <Badge status={c.enabled ? (c.lastTestOk === false ? 'crit' : 'ok') : 'neutral'}>
                    {c.enabled ? (c.lastTestOk === false ? 'Error' : 'Active') : 'Disabled'}
                  </Badge>
                  {c.awsAccountId && (
                    <span className="font-mono text-xs text-fg-faint">{c.awsAccountId}</span>
                  )}
                  {c.defaultRegion && (
                    <span className="font-mono text-xs text-fg-faint">{c.defaultRegion}</span>
                  )}
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
                  sections={AWS_SECTIONS}
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
        sections={AWS_SECTIONS}
        report={reportModalId ? reports[reportModalId] ?? null : null}
        checkedAt={connections.find((c) => c.id === reportModalId)?.lastTestedAt}
      />
    </WorkspaceShell>
  );
}
