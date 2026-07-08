'use client';

import { useEffect, useState } from 'react';
import { api, type PagerDutyConnection, type PagerDutyRegion, type PagerDutySignal, type PagerDutySignalReport, type PagerDutyTarget } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Badge } from '../ui/badge';
import { Input, Field, Select } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { SignalPills, type SignalSection } from '../ui/signal-pills';
import { SignalReportModal } from '../ui/signal-report-modal';
import { PagerDutyCredsForm } from './pagerduty-creds-form';
import { PagerDutyStepInstructions } from './pagerduty-step-instructions';

function errMsg(e: unknown, fallback: string): string { return e instanceof Error ? e.message : fallback; }

const SIGNALS: PagerDutySignal[] = ['alerts'];
const PAGERDUTY_SECTIONS: SignalSection[] = [
  { key: 'alerts', label: 'Alerts' },
];

export function PagerDutyTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/pagerduty`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<PagerDutyConnection[]>([]);
  const [targets, setTargets] = useState<PagerDutyTarget[]>([]);

  // add-target form
  const [connId, setConnId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deletingConnId, setDeletingConnId] = useState<string | null>(null);

  // verify
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, PagerDutySignalReport>>({});
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connections: PagerDutyConnection[] }>(`${base}/connections`),
      api<{ targets: PagerDutyTarget[] }>(`${base}/targets`),
    ])
      .then(([c, t]) => { setConnections(c.connections); setTargets(t.targets); setConnId(c.connections[0]?.id ?? ''); })
      .catch((e: { status?: number; message?: string }) => { if (e?.status !== 401) setError(e?.message ?? 'Failed to load PagerDuty'); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const canAddTarget = !!connId && (!!teamId.trim() || !!teamName.trim() || !!serviceId.trim() || !!serviceName.trim());

  async function addTarget() {
    if (!canAddTarget) return;
    setAdding(true); setError('');
    try {
      const res = await api<{ target: PagerDutyTarget }>(`${base}/targets`, {
        method: 'POST',
        body: JSON.stringify({
          connectionId: connId,
          teamId: teamId.trim() || undefined,
          teamName: teamName.trim() || undefined,
          serviceId: serviceId.trim() || undefined,
          serviceName: serviceName.trim() || undefined,
          label: label.trim() || undefined,
        }),
      });
      setTargets((prev) => [res.target, ...prev]);
      setTeamId(''); setTeamName(''); setServiceId(''); setServiceName(''); setLabel('');
    } catch (e) { setError(errMsg(e, 'Failed to add target')); }
    finally { setAdding(false); }
  }

  async function removeTarget(id: string) {
    setRemoving(id); setError('');
    try { await api<void>(`${base}/targets/${id}`, { method: 'DELETE' }); setTargets((prev) => prev.filter((t) => t.id !== id)); }
    catch (e) { setError(errMsg(e, 'Failed to remove')); }
    finally { setRemoving(null); }
  }

  async function verify(c: PagerDutyConnection) {
    setVerifyingId(c.id); setVerifyErrors((p) => ({ ...p, [c.id]: '' }));
    try {
      const res = await api<{ report: PagerDutySignalReport; availableSignals: string[] }>(`${base}/connections/${c.id}/verify`, { method: 'POST' });
      setReports((p) => ({ ...p, [c.id]: res.report }));
      setReportOpenId(c.id);
      const avail = SIGNALS.filter((s) => res.report[s]?.ok);
      setConnections((prev) => prev.map((x) => x.id === c.id ? { ...x, lastTestOk: avail.length > 0, lastTestedAt: new Date().toISOString(), metadata: { ...x.metadata, availableSignals: avail } } : x));
    } catch (e) { setVerifyErrors((p) => ({ ...p, [c.id]: errMsg(e, 'Verification failed') })); }
    finally { setVerifyingId(null); }
  }

  async function deleteConnection(c: PagerDutyConnection) {
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

  function onConnectionCreated(conn: PagerDutyConnection) {
    setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [conn, ...prev]));
    setConnId(conn.id);
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">PagerDuty</h2>
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
              <IntegrationHero provider="pagerduty">
                <div className="mx-auto flex flex-col gap-3 text-left">
                  <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                  <p className="text-xs text-fg-faint">
                    Connections you add here are private to this project. Org-shared connections are managed{' '}
                    <a href="/admin/pagerduty" className="text-accent hover:underline">at the org level</a>.
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
                        <Badge>{c.region.toUpperCase()}</Badge>
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
                      <SignalPills sections={PAGERDUTY_SECTIONS} available={c.metadata.availableSignals} checked={!!c.lastTestedAt}
                        errors={reports[c.id] ? Object.fromEntries(SIGNALS.map((s) => [s, reports[c.id]![s]?.error])) : undefined} />
                    </div>
                  ))}
                </div>
                <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                <p className="text-xs text-fg-faint">
                  Connections you add here are private to this project. Org-shared connections are managed{' '}
                  <a href="/admin/pagerduty" className="text-accent hover:underline">at the org level</a>.
                </p>
              </div>
            )}
          </section>

          {/* Scope = team/service targets */}
          {connections.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">The PagerDuty teams and services assistants can query.</p>
              </div>

              {targets.length > 0 && (
                <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                  {targets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        {(t.teamId ?? t.teamName) && (
                          <span className="truncate font-mono text-sm text-fg">
                            team: {t.teamName ?? t.teamId}
                          </span>
                        )}
                        {(t.serviceId ?? t.serviceName) && (
                          <span className="truncate font-mono text-xs text-fg-faint">
                            service: {t.serviceName ?? t.serviceId}
                          </span>
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
                  <Field label="Team ID (optional)">
                    <Input value={teamId} placeholder="P123ABC" onChange={(e) => setTeamId(e.target.value)} />
                  </Field>
                  <Field label="Team name (optional)">
                    <Input value={teamName} placeholder="Platform" onChange={(e) => setTeamName(e.target.value)} />
                  </Field>
                  <Field label="Service ID (optional)">
                    <Input value={serviceId} placeholder="P456DEF" onChange={(e) => setServiceId(e.target.value)} />
                  </Field>
                  <Field label="Service name (optional)">
                    <Input value={serviceName} placeholder="checkout" onChange={(e) => setServiceName(e.target.value)} />
                  </Field>
                  <Field label="Label (optional)">
                    <Input value={label} placeholder="Production checkout" onChange={(e) => setLabel(e.target.value)} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={adding || !canAddTarget} onClick={addTarget}>{adding ? 'Adding…' : 'Add target'}</Button>
                  <p className="text-xs text-fg-faint">At least one of team or service is required. Both can be combined for a narrower scope.</p>
                </div>
              </div>
            </section>
          )}

          <SignalReportModal
            open={reportOpenId !== null}
            onClose={() => setReportOpenId(null)}
            title={`${connections.find((c) => c.id === reportOpenId)?.name ?? 'Connection'} — verification report`}
            sections={PAGERDUTY_SECTIONS}
            report={reportOpenId ? reports[reportOpenId] ?? null : null}
            checkedAt={connections.find((c) => c.id === reportOpenId)?.lastTestedAt}
          />
        </>
      )}
    </div>
  );
}

/** Inline form to create a project-OWNED PagerDuty connection (private to this project). */
function AddConnectionForm({ slug, onCreated }: { slug: string; onCreated: (c: PagerDutyConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [region, setRegion] = useState<PagerDutyRegion>('us');
  const [apiToken, setApiToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const canSave = !!name.trim() && !!apiToken.trim() && !saving;

  async function add() {
    setSaving(true); setErr('');
    try {
      const res = await api<{ connection: PagerDutyConnection }>(`/api/org/projects/${slug}/pagerduty/connections`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), region, apiToken }),
      });
      onCreated(res.connection);
      setOpen(false);
      setName(''); setRegion('us'); setApiToken('');
    } catch (e) {
      setErr(errMsg(e, 'Failed to add connection'));
    } finally { setSaving(false); }
  }

  if (!open) return (<div><Button variant="secondary" onClick={() => setOpen(true)}>Add a connection</Button></div>);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add a connection</h4>
      <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
      <PagerDutyCredsForm
        region={region} onRegionChange={setRegion}
        apiToken={apiToken} onApiTokenChange={setApiToken}
      />
      <PagerDutyStepInstructions />
      {err && <p className="text-sm text-crit">{err}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={!canSave} onClick={add}>{saving ? 'Adding…' : 'Add connection'}</Button>
        <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
