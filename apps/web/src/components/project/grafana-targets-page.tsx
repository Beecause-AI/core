'use client';

import { useEffect, useState } from 'react';
import { api, type GrafanaConnection, type GrafanaTarget, type GrafanaSignal, type GrafanaSignalReport, type GrafanaDiscoveredDatasource } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Input, Select, Field } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { SignalPills, type SignalSection } from '../ui/signal-pills';
import { SignalReportModal } from '../ui/signal-report-modal';

const SIGNALS: GrafanaSignal[] = ['metrics', 'logs', 'traces'];
const GRAFANA_SECTIONS: SignalSection[] = [
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'traces', label: 'Traces' },
];

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export function GrafanaTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/grafana`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [connection, setConnection] = useState<GrafanaConnection | null>(null);
  const [connections, setConnections] = useState<GrafanaConnection[]>([]);
  const [targets, setTargets] = useState<GrafanaTarget[]>([]);

  const [pickConnId, setPickConnId] = useState('');
  const [binding, setBinding] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<GrafanaSignalReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const [restricting, setRestricting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const unrestricted = targets.length === 0;
  const showSpecific = !unrestricted || restricting;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connection: GrafanaConnection | null }>(`${base}/connection`),
      api<{ connections: GrafanaConnection[] }>(`${base}/connections`),
    ])
      .then(([c, list]) => {
        setConnection(c.connection);
        setConnections(list.connections);
        setPickConnId(c.connection?.id ?? list.connections[0]?.id ?? '');
        return c.connection ? loadTargets() : Promise.resolve();
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setError(e?.message ?? 'Failed to load Grafana');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function loadTargets() {
    const t = await api<{ targets: GrafanaTarget[] }>(`${base}/targets`);
    setTargets(t.targets);
    setRestricting(false);
  }

  async function bind(connectionId: string) {
    if (!connectionId) return;
    setBinding(true); setError(''); setVerifyError(''); setReport(null);
    try {
      const res = await api<{ connection: GrafanaConnection }>(`${base}/connection`, {
        method: 'PUT', body: JSON.stringify({ connectionId }),
      });
      setConnection(res.connection);
      await loadTargets();
    } catch (e) {
      setError(errMsg(e, 'Failed to set connection'));
    } finally { setBinding(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this Grafana connection? This clears the project’s scope.')) return;
    setBinding(true); setError('');
    try {
      await api<void>(`${base}/connection`, { method: 'DELETE' });
      setConnection(null); setTargets([]); setRestricting(false); setReport(null); setVerifyError('');
      setPickConnId(connections[0]?.id ?? '');
    } catch (e) {
      setError(errMsg(e, 'Failed to disconnect'));
    } finally { setBinding(false); }
  }

  async function verify() {
    if (!connection) return;
    setVerifying(true); setVerifyError(''); setReport(null);
    try {
      const res = await api<{ report: GrafanaSignalReport; availableSignals: string[] }>(
        `${base}/connection/verify`,
        { method: 'POST' },
      );
      setReport(res.report); setReportOpen(true);
      const avail = SIGNALS.filter((s) => res.report[s]?.ok);
      setConnection((prev) => (prev ? { ...prev, lastTestOk: avail.length > 0, lastTestedAt: new Date().toISOString(), metadata: { ...prev.metadata, availableSignals: avail } } : prev));
    } catch (e) {
      setVerifyError(errMsg(e, 'Verification failed'));
    } finally { setVerifying(false); }
  }

  function onConnectionCreated(conn: GrafanaConnection) {
    setConnection(conn);
    setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [conn, ...prev]));
    setPickConnId(conn.id);
    setTargets([]); setRestricting(false); setReport(null); setVerifyError('');
  }

  async function deleteOwnedConnection() {
    if (!connection) return;
    if (!window.confirm('Delete this project connection? This removes it and clears the project’s scope.')) return;
    setBinding(true); setError('');
    try {
      await api<void>(`${base}/connections/${connection.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((c) => c.id !== connection.id));
      setConnection(null); setTargets([]); setRestricting(false); setReport(null); setVerifyError(''); setPickConnId('');
    } catch (e) {
      setError(errMsg(e, 'Failed to delete connection'));
    } finally { setBinding(false); }
  }

  async function removeTarget(id: string) {
    setRemoving(id); setError('');
    try {
      await api<void>(`${base}/targets/${id}`, { method: 'DELETE' });
      setTargets((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(errMsg(e, 'Failed to remove datasource'));
    } finally { setRemoving(null); }
  }

  async function makeUnrestricted() {
    if (targets.length === 0) { setRestricting(false); return; }
    if (!window.confirm(`Make scope unrestricted? This removes the ${targets.length} selected datasource(s).`)) return;
    setError('');
    try {
      await Promise.all(targets.map((t) => api<void>(`${base}/targets/${t.id}`, { method: 'DELETE' })));
      setTargets([]); setRestricting(false);
    } catch (e) {
      setError(errMsg(e, 'Failed to clear datasources'));
    }
  }

  function onAdded(t: GrafanaTarget) { setTargets((prev) => [t, ...prev]); }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">Grafana</h2>
      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? (<Skeleton rows={4} />) : (
        <>
          {/* ── Connection ─────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">Connection</h3>
              <p className="text-sm text-fg-muted">The Grafana connection this project uses.</p>
            </div>

            {connection ? (
              <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-fg">{connection.name}</span>
                    <span className="font-mono text-xs text-fg-faint">{connection.baseUrl}</span>
                  </div>
                  <div className="flex items-end gap-2">
                    {connections.length > 1 && (
                      <div className="flex items-end gap-2">
                        <Select className="w-56" value={pickConnId} disabled={binding}
                          onChange={(e) => setPickConnId(e.target.value)} aria-label="Change connection">
                          {connections.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                        </Select>
                        <Button variant="secondary" disabled={binding || pickConnId === connection.id} onClick={() => bind(pickConnId)}>Change</Button>
                      </div>
                    )}
                    <Button variant="ghost" disabled={verifying} onClick={() => void verify()}>{verifying ? 'Verifying…' : 'Verify'}</Button>
                    {report && (<Button variant="ghost" onClick={() => setReportOpen(true)}>View report</Button>)}
                    <Button variant="ghost" disabled={binding} onClick={disconnect}>Disconnect</Button>
                    {connection.projectId !== null && (
                      <Button variant="ghost" disabled={binding} onClick={deleteOwnedConnection}>Delete</Button>
                    )}
                  </div>
                </div>
                {connection.projectId !== null && (<span className="text-xs text-fg-faint">Private to this project</span>)}
                {connection.lastTestedAt && (
                  <p className="text-xs text-fg-faint">
                    Checked {new Date(connection.lastTestedAt).toLocaleString()} &middot; {connection.lastTestOk === false ? 'Failed' : 'OK'}
                  </p>
                )}
                {verifyError && <p className="text-sm text-crit">{verifyError}</p>}
                <SignalPills sections={GRAFANA_SECTIONS} available={connection.metadata.availableSignals} checked={!!connection.lastTestedAt}
                  errors={report ? Object.fromEntries(SIGNALS.map((s) => [s, report[s]?.error])) : undefined} />
              </div>
            ) : connections.length === 0 ? (
              <IntegrationHero provider="grafana">
                <div className="mx-auto max-w-xl text-left flex flex-col gap-3">
                  <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                  <p className="text-xs text-fg-faint">
                    Connections you add here are private to this project. Org-shared connections are managed{' '}
                    <a href="/admin/grafana" className="text-accent hover:underline">at the org level</a>.
                  </p>
                </div>
              </IntegrationHero>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end gap-2">
                  <Select className="w-72" value={pickConnId} disabled={binding} onChange={(e) => setPickConnId(e.target.value)} aria-label="Connection">
                    {connections.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </Select>
                  <Button disabled={binding || !pickConnId} onClick={() => bind(pickConnId)}>{binding ? 'Connecting…' : 'Use connection'}</Button>
                </div>
                <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                <p className="text-xs text-fg-faint">
                  Connections you add here are private to this project. Org-shared connections are managed{' '}
                  <a href="/admin/grafana" className="text-accent hover:underline">at the org level</a>.
                </p>
              </div>
            )}
          </section>

          {/* ── Scope ──────────────────────────────────────────────── */}
          {connection && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">Which datasources assistants can query.</p>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={makeUnrestricted}
                  className={`rounded-md border px-3 py-1.5 text-sm ${!showSpecific ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-fg-muted hover:bg-raised'}`}>
                  All datasources
                </button>
                <button type="button" onClick={() => setRestricting(true)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${showSpecific ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-fg-muted hover:bg-raised'}`}>
                  Specific datasources
                </button>
              </div>

              {!showSpecific ? (
                <div className="flex flex-col items-start gap-3 rounded-card border border-edge bg-surface p-5">
                  <p className="text-sm text-fg-muted">Assistants can query any datasource this connection&apos;s token can access.</p>
                  <Button variant="secondary" onClick={() => setRestricting(true)}>Restrict to specific datasources</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {targets.length > 0 && (
                    <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                      {targets.map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="truncate text-sm text-fg">{t.name}</span>
                            <span className="font-mono text-xs text-fg-faint">{t.datasourceType}</span>
                          </div>
                          <Button variant="ghost" disabled={removing === t.id} onClick={() => removeTarget(t.id)}>
                            {removing === t.id ? 'Removing…' : 'Remove'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <AddDatasourceForm base={base} connectionId={connection.id} targets={targets} onAdded={onAdded} />
                </div>
              )}
            </section>
          )}
        </>
      )}

      <SignalReportModal open={reportOpen} onClose={() => setReportOpen(false)}
        title={`${connection?.name ?? 'Connection'} — verification report`}
        sections={GRAFANA_SECTIONS} report={report} checkedAt={connection?.lastTestedAt} />
    </div>
  );
}

/** Inline form to create a project-OWNED Grafana connection (private to this project).
 *  Auto-binds on create (handled server-side). */
function AddConnectionForm({ slug, onCreated }: { slug: string; onCreated: (c: GrafanaConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const canSave = !!name.trim() && !!baseUrl.trim() && !!token.trim() && !saving;

  async function add() {
    setSaving(true); setErr('');
    try {
      const body = { name: name.trim(), baseUrl: baseUrl.trim(), token: token.trim() };
      const res = await api<{ connection: GrafanaConnection }>(`/api/org/projects/${slug}/grafana/connections`, {
        method: 'POST', body: JSON.stringify(body),
      });
      onCreated(res.connection);
      setOpen(false);
      setName(''); setBaseUrl(''); setToken('');
    } catch (e) {
      setErr(errMsg(e, 'Failed to add connection'));
    } finally { setSaving(false); }
  }

  if (!open) return (<div><Button variant="secondary" onClick={() => setOpen(true)}>Add a connection</Button></div>);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add a connection</h4>
      <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Base URL"><Input className="font-mono" value={baseUrl} placeholder="https://grafana.acme.io" onChange={(e) => setBaseUrl(e.target.value)} /></Field>
      <Field label="Service account token"><Input type="password" value={token} placeholder="glsa_…" onChange={(e) => setToken(e.target.value)} /></Field>
      {err && <p className="text-sm text-crit">{err}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={!canSave} onClick={add}>{saving ? 'Adding…' : 'Add connection'}</Button>
        <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Inline form to add ONE allowed datasource to the scope. Uses discovery with a manual
 *  fallback when the token can't list the instance's datasources. */
function AddDatasourceForm({
  base, connectionId, targets, onAdded,
}: {
  base: string; connectionId: string; targets: GrafanaTarget[]; onAdded: (t: GrafanaTarget) => void;
}) {
  const [discovered, setDiscovered] = useState<GrafanaDiscoveredDatasource[] | null>(null);
  const [discoveryErr, setDiscoveryErr] = useState('');

  const [uidSel, setUidSel] = useState('');
  const [manualUid, setManualUid] = useState('');
  const [manualType, setManualType] = useState('prometheus');
  const [manualName, setManualName] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setDiscovered(null); setDiscoveryErr('');
    api<{ datasources: GrafanaDiscoveredDatasource[] }>(`${base}/discovery/datasources?connectionId=${encodeURIComponent(connectionId)}`)
      .then((r) => setDiscovered(r.datasources))
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setDiscoveryErr(e?.message ?? 'Failed to list datasources');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, connectionId]);

  const addedUids = new Set(targets.map((t) => t.datasourceUid));
  const options = (discovered ?? []).filter((d) => !addedUids.has(d.uid));
  const manualMode = !!discoveryErr;

  const canAdd = manualMode
    ? !!manualUid.trim() && !!manualType.trim() && !addedUids.has(manualUid.trim()) && !saving
    : !!uidSel && !saving;

  async function add() {
    setSaving(true); setSaveError('');
    try {
      let body: Record<string, unknown>;
      if (manualMode) {
        body = { datasourceUid: manualUid.trim(), datasourceType: manualType.trim(), name: (manualName.trim() || manualUid.trim()) };
      } else {
        const d = options.find((o) => o.uid === uidSel);
        if (!d) { setSaveError('Pick a datasource'); setSaving(false); return; }
        body = { datasourceUid: d.uid, datasourceType: d.type, name: d.name };
      }
      const res = await api<{ target: GrafanaTarget }>(`${base}/targets`, { method: 'POST', body: JSON.stringify(body) });
      onAdded(res.target);
      setUidSel(''); setManualUid(''); setManualType('prometheus'); setManualName('');
    } catch (e) {
      setSaveError(errMsg(e, 'Failed to add datasource'));
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add datasource</h4>

      {manualMode ? (
        <>
          <p className="text-xs text-fg-faint">Couldn&apos;t list datasources automatically ({discoveryErr}). Enter the datasource manually:</p>
          <div className="flex flex-col gap-2">
            <Input className="font-mono" value={manualUid} onChange={(e) => setManualUid(e.target.value.trim())} placeholder="Datasource UID" />
            <Select value={manualType} onChange={(e) => setManualType(e.target.value)} aria-label="Datasource type">
              <option value="prometheus">prometheus (metrics)</option>
              <option value="loki">loki (logs)</option>
              <option value="tempo">tempo (traces)</option>
            </Select>
            <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Display name (optional)" />
          </div>
        </>
      ) : (
        <Select value={uidSel} disabled={discovered === null} onChange={(e) => setUidSel(e.target.value)} aria-label="Datasource">
          <option value="">{discovered === null ? 'Loading…' : options.length === 0 ? 'All datasources already in scope' : 'Select a datasource…'}</option>
          {options.map((d) => (<option key={d.uid} value={d.uid}>{d.name} ({d.type})</option>))}
        </Select>
      )}

      {saveError && <p className="text-sm text-crit">{saveError}</p>}
      <div className="flex items-center justify-end">
        <Button disabled={!canAdd} onClick={add}>{saving ? 'Adding…' : 'Add'}</Button>
      </div>
    </div>
  );
}
