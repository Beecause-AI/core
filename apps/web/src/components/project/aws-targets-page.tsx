'use client';

import { useEffect, useState } from 'react';
import { api, type AwsConnection, type AwsMode, type AwsSignal, type AwsSignalReport, type AwsTarget } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Badge } from '../ui/badge';
import { Input, Field, Select } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { SignalPills, type SignalSection } from '../ui/signal-pills';
import { SignalReportModal } from '../ui/signal-report-modal';
import { AwsCredsForm } from './aws-creds-form';

function errMsg(e: unknown, fallback: string): string { return e instanceof Error ? e.message : fallback; }

const SIGNALS: AwsSignal[] = ['metrics', 'logs', 'traces', 'alarms'];
const AWS_SECTIONS: SignalSection[] = [
  { key: 'metrics', label: 'Metrics' }, { key: 'logs', label: 'Logs' },
  { key: 'traces', label: 'Traces' }, { key: 'alarms', label: 'Alarms' },
];
const REGIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-central-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1', 'ca-central-1'];

export function AwsTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/aws`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<AwsConnection[]>([]);
  const [targets, setTargets] = useState<AwsTarget[]>([]);

  // add-target form
  const [connId, setConnId] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deletingConnId, setDeletingConnId] = useState<string | null>(null);

  // verify
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, AwsSignalReport>>({});
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connections: AwsConnection[] }>(`${base}/connections`),
      api<{ targets: AwsTarget[] }>(`${base}/targets`),
    ])
      .then(([c, t]) => { setConnections(c.connections); setTargets(t.targets); setConnId(c.connections[0]?.id ?? ''); })
      .catch((e: { status?: number; message?: string }) => { if (e?.status !== 401) setError(e?.message ?? 'Failed to load AWS'); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function addTarget() {
    if (!connId) return;
    setAdding(true); setError('');
    try {
      const res = await api<{ target: AwsTarget }>(`${base}/targets`, { method: 'POST', body: JSON.stringify({ connectionId: connId, region }) });
      setTargets((prev) => [res.target, ...prev]);
    } catch (e) { setError(errMsg(e, 'Failed to add account/region')); }
    finally { setAdding(false); }
  }

  async function removeTarget(id: string) {
    setRemoving(id); setError('');
    try { await api<void>(`${base}/targets/${id}`, { method: 'DELETE' }); setTargets((prev) => prev.filter((t) => t.id !== id)); }
    catch (e) { setError(errMsg(e, 'Failed to remove')); }
    finally { setRemoving(null); }
  }

  async function verify(c: AwsConnection) {
    setVerifyingId(c.id); setVerifyErrors((p) => ({ ...p, [c.id]: '' }));
    try {
      const res = await api<{ report: AwsSignalReport; availableSignals: string[]; awsAccountId: string }>(`${base}/connections/${c.id}/verify`, { method: 'POST' });
      setReports((p) => ({ ...p, [c.id]: res.report }));
      setReportOpenId(c.id);
      const avail = SIGNALS.filter((s) => res.report[s]?.ok);
      setConnections((prev) => prev.map((x) => x.id === c.id ? { ...x, awsAccountId: res.awsAccountId, lastTestOk: avail.length > 0, lastTestedAt: new Date().toISOString(), metadata: { ...x.metadata, availableSignals: avail } } : x));
    } catch (e) { setVerifyErrors((p) => ({ ...p, [c.id]: errMsg(e, 'Verification failed') })); }
    finally { setVerifyingId(null); }
  }

  async function deleteConnection(c: AwsConnection) {
    if (!window.confirm(`Delete connection "${c.name}"? This removes it and all its targets from this project.`)) return;
    setDeletingConnId(c.id); setError('');
    try {
      await api<void>(`/api/org/projects/${slug}/aws/connections/${c.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      setTargets((prev) => prev.filter((t) => t.connectionId !== c.id));
      // If the deleted connection was selected in the target picker, reset to first remaining
      setConnId((prev) => {
        if (prev !== c.id) return prev;
        const remaining = connections.filter((x) => x.id !== c.id);
        return remaining[0]?.id ?? '';
      });
    } catch (e) { setError(errMsg(e, 'Failed to delete connection')); }
    finally { setDeletingConnId(null); }
  }

  function onConnectionCreated(conn: AwsConnection) {
    setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [conn, ...prev]));
    // Select the new connection in the target picker
    setConnId(conn.id);
  }

  const selectedConn = connections.find((c) => c.id === connId);

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">AWS</h2>
      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? <Skeleton rows={4} /> : (
        <>
          {/* Connections + verify */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">Connections</h3>
              <p className="text-sm text-fg-muted">Verify each account to see which signals assistants can query.</p>
            </div>

            {connections.length === 0 ? (
              <IntegrationHero provider="aws">
                <div className="mx-auto max-w-xl text-left flex flex-col gap-3">
                  <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                  <p className="text-xs text-fg-faint">
                    Connections you add here are private to this project. Org-shared connections are managed{' '}
                    <a href="/admin/aws" className="text-accent hover:underline">at the org level</a>.
                  </p>
                </div>
              </IntegrationHero>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                  {connections.map((c) => (
                    <div key={c.id} className="flex flex-col gap-2 px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-fg">{c.name}</span>
                        <Badge>{c.mode === 'assume_role' ? 'IAM role' : 'Access key'}</Badge>
                        {c.projectId !== null && <Badge>Private</Badge>}
                        {c.awsAccountId && <span className="font-mono text-xs text-fg-faint">{c.awsAccountId}</span>}
                        <div className="ml-auto flex items-center gap-1">
                          <Button variant="ghost" disabled={verifyingId === c.id} onClick={() => verify(c)}>{verifyingId === c.id ? 'Verifying…' : 'Verify'}</Button>
                          {reports[c.id] && <Button variant="ghost" onClick={() => setReportOpenId(c.id)}>View report</Button>}
                          {c.projectId !== null && (
                            <Button variant="ghost" disabled={deletingConnId === c.id} onClick={() => void deleteConnection(c)}>
                              {deletingConnId === c.id ? 'Deleting…' : 'Delete'}
                            </Button>
                          )}
                        </div>
                      </div>
                      {verifyErrors[c.id] && <p className="text-sm text-crit">{verifyErrors[c.id]}</p>}
                      <SignalPills sections={AWS_SECTIONS} available={c.metadata.availableSignals} checked={!!c.lastTestedAt}
                        errors={reports[c.id] ? Object.fromEntries(SIGNALS.map((s) => [s, reports[c.id]![s]?.error])) : undefined} />
                    </div>
                  ))}
                </div>
                <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                <p className="text-xs text-fg-faint">
                  Connections you add here are private to this project. Org-shared connections are managed{' '}
                  <a href="/admin/aws" className="text-accent hover:underline">at the org level</a>.
                </p>
              </div>
            )}
          </section>

          {/* Scope = account/region targets */}
          {connections.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">The AWS account + region pairs assistants can query.</p>
              </div>

              {targets.length > 0 && (
                <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                  {targets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="truncate font-mono text-sm text-fg">{t.awsAccountId} / {t.awsRegion}</span>
                        {t.label && <Badge>{t.label}</Badge>}
                      </div>
                      <Button variant="ghost" disabled={removing === t.id} onClick={() => removeTarget(t.id)}>{removing === t.id ? 'Removing…' : 'Remove'}</Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2 rounded-card border border-edge bg-surface p-5">
                <label className="flex flex-col gap-1 text-sm text-fg-muted">Connection (account)
                  <Select className="w-64" value={connId} onChange={(e) => setConnId(e.target.value)}>
                    {connections.map((c) => <option key={c.id} value={c.id}>{c.name}{c.awsAccountId ? ` · ${c.awsAccountId}` : ''}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-fg-muted">Region
                  <Select className="w-44" value={region} onChange={(e) => setRegion(e.target.value)}>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </label>
                <Button disabled={adding || !connId || !selectedConn?.awsAccountId} onClick={addTarget}>{adding ? 'Adding…' : 'Add account/region'}</Button>
                {selectedConn && !selectedConn.awsAccountId && <span className="text-sm text-fg-muted">Verify this connection first.</span>}
              </div>
            </section>
          )}

          <SignalReportModal
            open={reportOpenId !== null}
            onClose={() => setReportOpenId(null)}
            title={`${connections.find((c) => c.id === reportOpenId)?.name ?? 'Connection'} — verification report`}
            sections={AWS_SECTIONS}
            report={reportOpenId ? reports[reportOpenId] ?? null : null}
            checkedAt={connections.find((c) => c.id === reportOpenId)?.lastTestedAt}
          />
        </>
      )}
    </div>
  );
}

/** Inline form to create a project-OWNED AWS connection (private to this project).
 *  No auto-bind — admin then verifies + adds targets as usual. */
function AddConnectionForm({ slug, onCreated }: { slug: string; onCreated: (c: AwsConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<AwsMode>('assume_role');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [defaultRegion, setDefaultRegion] = useState('us-east-1');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const canSave = !!name.trim() && !!defaultRegion &&
    (mode === 'assume_role' ? !!roleArn.trim() : !!accessKeyId.trim() && !!secretAccessKey.trim()) &&
    !saving;

  async function add() {
    setSaving(true); setErr('');
    try {
      const body: Record<string, unknown> = { name: name.trim(), mode, defaultRegion };
      if (mode === 'access_key') {
        body.accessKeyId = accessKeyId.trim();
        body.secretAccessKey = secretAccessKey;
      } else {
        body.roleArn = roleArn.trim();
      }
      const res = await api<{ connection: AwsConnection }>(`/api/org/projects/${slug}/aws/connections`, {
        method: 'POST', body: JSON.stringify(body),
      });
      onCreated(res.connection);
      setOpen(false);
      setName(''); setMode('assume_role'); setAccessKeyId(''); setSecretAccessKey(''); setRoleArn(''); setDefaultRegion('us-east-1');
    } catch (e) {
      setErr(errMsg(e, 'Failed to add connection'));
    } finally { setSaving(false); }
  }

  if (!open) return (<div><Button variant="secondary" onClick={() => setOpen(true)}>Add a connection</Button></div>);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add a connection</h4>
      <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
      <AwsCredsForm
        mode={mode} onModeChange={setMode}
        accessKeyId={accessKeyId} onAccessKeyIdChange={setAccessKeyId}
        secretAccessKey={secretAccessKey} onSecretAccessKeyChange={setSecretAccessKey}
        roleArn={roleArn} onRoleArnChange={setRoleArn}
        defaultRegion={defaultRegion} onDefaultRegionChange={setDefaultRegion}
      />
      {err && <p className="text-sm text-crit">{err}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={!canSave} onClick={add}>{saving ? 'Adding…' : 'Add connection'}</Button>
        <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
