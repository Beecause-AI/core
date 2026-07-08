'use client';

import { useEffect, useState } from 'react';
import { api, type DatadogConnection, type DatadogSignal, type DatadogSignalReport, type DatadogTarget } from '../../lib/api';
import type { DatadogSite } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Badge } from '../ui/badge';
import { Input, Field, Select } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { SignalPills, type SignalSection } from '../ui/signal-pills';
import { SignalReportModal } from '../ui/signal-report-modal';
import { DatadogCredsForm } from './datadog-creds-form';

function errMsg(e: unknown, fallback: string): string { return e instanceof Error ? e.message : fallback; }

const SIGNALS: DatadogSignal[] = ['metrics', 'logs', 'traces', 'alerts'];
const DATADOG_SECTIONS: SignalSection[] = [
  { key: 'metrics', label: 'Metrics' }, { key: 'logs', label: 'Logs' },
  { key: 'traces', label: 'Traces' }, { key: 'alerts', label: 'Alerts' },
];

export function DatadogTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/datadog`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<DatadogConnection[]>([]);
  const [targets, setTargets] = useState<DatadogTarget[]>([]);

  // add-target form
  const [connId, setConnId] = useState('');
  const [env, setEnv] = useState('');
  const [service, setService] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deletingConnId, setDeletingConnId] = useState<string | null>(null);

  // verify
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, DatadogSignalReport>>({});
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connections: DatadogConnection[] }>(`${base}/connections`),
      api<{ targets: DatadogTarget[] }>(`${base}/targets`),
    ])
      .then(([c, t]) => { setConnections(c.connections); setTargets(t.targets); setConnId(c.connections[0]?.id ?? ''); })
      .catch((e: { status?: number; message?: string }) => { if (e?.status !== 401) setError(e?.message ?? 'Failed to load Datadog'); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function addTarget() {
    if (!connId || !env.trim()) return;
    setAdding(true); setError('');
    try {
      const res = await api<{ target: DatadogTarget }>(`${base}/targets`, {
        method: 'POST',
        body: JSON.stringify({
          connectionId: connId,
          env: env.trim(),
          service: service.trim() || undefined,
          label: label.trim() || undefined,
        }),
      });
      setTargets((prev) => [res.target, ...prev]);
      setEnv(''); setService(''); setLabel('');
    } catch (e) { setError(errMsg(e, 'Failed to add target')); }
    finally { setAdding(false); }
  }

  async function removeTarget(id: string) {
    setRemoving(id); setError('');
    try { await api<void>(`${base}/targets/${id}`, { method: 'DELETE' }); setTargets((prev) => prev.filter((t) => t.id !== id)); }
    catch (e) { setError(errMsg(e, 'Failed to remove')); }
    finally { setRemoving(null); }
  }

  async function verify(c: DatadogConnection) {
    setVerifyingId(c.id); setVerifyErrors((p) => ({ ...p, [c.id]: '' }));
    try {
      const res = await api<{ report: DatadogSignalReport; availableSignals: string[] }>(`${base}/connections/${c.id}/verify`, { method: 'POST' });
      setReports((p) => ({ ...p, [c.id]: res.report }));
      setReportOpenId(c.id);
      const avail = SIGNALS.filter((s) => res.report[s]?.ok);
      setConnections((prev) => prev.map((x) => x.id === c.id ? { ...x, lastTestOk: avail.length > 0, lastTestedAt: new Date().toISOString(), metadata: { ...x.metadata, availableSignals: avail } } : x));
    } catch (e) { setVerifyErrors((p) => ({ ...p, [c.id]: errMsg(e, 'Verification failed') })); }
    finally { setVerifyingId(null); }
  }

  async function deleteConnection(c: DatadogConnection) {
    if (!window.confirm(`Delete connection "${c.name}"? This removes it and all its targets from this project.`)) return;
    setDeletingConnId(c.id); setError('');
    try {
      await api<void>(`${base}/connections/${c.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      setTargets((prev) => prev.filter((t) => t.connectionId !== c.id));
      setConnId((prev) => {
        if (prev !== c.id) return prev;
        const remaining = connections.filter((x) => x.id !== c.id);
        return remaining[0]?.id ?? '';
      });
    } catch (e) { setError(errMsg(e, 'Failed to delete connection')); }
    finally { setDeletingConnId(null); }
  }

  function onConnectionCreated(conn: DatadogConnection) {
    setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [conn, ...prev]));
    setConnId(conn.id);
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">Datadog</h2>
      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? <Skeleton rows={4} /> : (
        <>
          {/* Connections + verify */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">Connections</h3>
              <p className="text-sm text-fg-muted">Verify each connection to see which signals assistants can query.</p>
            </div>

            {connections.length === 0 ? (
              <IntegrationHero provider="datadog">
                <div className="mx-auto flex max-w-xl flex-col gap-3 text-left">
                  <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                  <p className="text-xs text-fg-faint">
                    Connections you add here are private to this project. Org-shared connections are managed{' '}
                    <a href="/admin/datadog" className="text-accent hover:underline">at the org level</a>.
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
                        <Badge>{c.site}</Badge>
                        {c.projectId !== null && <Badge>Private</Badge>}
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
                      <SignalPills sections={DATADOG_SECTIONS} available={c.metadata.availableSignals} checked={!!c.lastTestedAt}
                        errors={reports[c.id] ? Object.fromEntries(SIGNALS.map((s) => [s, reports[c.id]![s]?.error])) : undefined} />
                    </div>
                  ))}
                </div>
                <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                <p className="text-xs text-fg-faint">
                  Connections you add here are private to this project. Org-shared connections are managed{' '}
                  <a href="/admin/datadog" className="text-accent hover:underline">at the org level</a>.
                </p>
              </div>
            )}
          </section>

          {/* Scope = env/service targets */}
          {connections.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">The Datadog environments and services assistants can query.</p>
              </div>

              {targets.length > 0 && (
                <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                  {targets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-mono text-sm text-fg">{t.env}</span>
                        {t.service && (
                          <span className="truncate font-mono text-xs text-fg-faint">service: {t.service}</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {t.label && <Badge>{t.label}</Badge>}
                        <Button variant="ghost" disabled={removing === t.id} onClick={() => removeTarget(t.id)}>{removing === t.id ? 'Removing…' : 'Remove'}</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-4 rounded-card border border-edge bg-surface p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Connection">
                    <Select value={connId} onChange={(e) => setConnId(e.target.value)}>
                      {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Environment">
                    <Input value={env} placeholder="prod" onChange={(e) => setEnv(e.target.value)} />
                  </Field>
                  <Field label="Service (optional)">
                    <Input value={service} placeholder="checkout" onChange={(e) => setService(e.target.value)} />
                  </Field>
                  <Field label="Label (optional)">
                    <Input value={label} placeholder="Production checkout" onChange={(e) => setLabel(e.target.value)} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={adding || !connId || !env.trim()} onClick={addTarget}>{adding ? 'Adding…' : 'Add target'}</Button>
                  <p className="text-xs text-fg-faint">The environment is required. A service narrows the scope further.</p>
                </div>
              </div>
            </section>
          )}

          <SignalReportModal
            open={reportOpenId !== null}
            onClose={() => setReportOpenId(null)}
            title={`${connections.find((c) => c.id === reportOpenId)?.name ?? 'Connection'} — verification report`}
            sections={DATADOG_SECTIONS}
            report={reportOpenId ? reports[reportOpenId] ?? null : null}
            checkedAt={connections.find((c) => c.id === reportOpenId)?.lastTestedAt}
          />
        </>
      )}
    </div>
  );
}

/** Inline form to create a project-OWNED Datadog connection (private to this project). */
function AddConnectionForm({ slug, onCreated }: { slug: string; onCreated: (c: DatadogConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [site, setSite] = useState<DatadogSite>('us1');
  const [apiKey, setApiKey] = useState('');
  const [appKey, setAppKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const canSave = !!name.trim() && !!apiKey.trim() && !!appKey.trim() && !saving;

  async function add() {
    setSaving(true); setErr('');
    try {
      const res = await api<{ connection: DatadogConnection }>(`/api/org/projects/${slug}/datadog/connections`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), site, apiKey, appKey }),
      });
      onCreated(res.connection);
      setOpen(false);
      setName(''); setSite('us1'); setApiKey(''); setAppKey('');
    } catch (e) {
      setErr(errMsg(e, 'Failed to add connection'));
    } finally { setSaving(false); }
  }

  if (!open) return (<div><Button variant="secondary" onClick={() => setOpen(true)}>Add a connection</Button></div>);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add a connection</h4>
      <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
      <DatadogCredsForm
        site={site} onSiteChange={setSite}
        apiKey={apiKey} onApiKeyChange={setApiKey}
        appKey={appKey} onAppKeyChange={setAppKey}
      />
      {err && <p className="text-sm text-crit">{err}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={!canSave} onClick={add}>{saving ? 'Adding…' : 'Add connection'}</Button>
        <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
