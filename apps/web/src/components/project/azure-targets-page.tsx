'use client';

import { useEffect, useState } from 'react';
import { api, type AzureConnection, type AzureMode, type AzureSignal, type AzureSignalReport, type AzureTarget } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Badge } from '../ui/badge';
import { Input, Field, Select } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { SignalPills, type SignalSection } from '../ui/signal-pills';
import { SignalReportModal } from '../ui/signal-report-modal';
import { AzureCredsForm } from './azure-creds-form';

function errMsg(e: unknown, fallback: string): string { return e instanceof Error ? e.message : fallback; }

const SIGNALS: AzureSignal[] = ['metrics', 'logs', 'traces', 'alerts'];
const AZURE_SECTIONS: SignalSection[] = [
  { key: 'metrics', label: 'Metrics' }, { key: 'logs', label: 'Logs' },
  { key: 'traces', label: 'Traces' }, { key: 'alerts', label: 'Alerts' },
];
const REGIONS = ['eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus', 'northcentralus', 'southcentralus', 'northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral', 'switzerlandnorth', 'swedencentral', 'southeastasia', 'eastasia', 'australiaeast', 'japaneast', 'centralindia', 'canadacentral', 'brazilsouth'];

export function AzureTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/azure`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<AzureConnection[]>([]);
  const [targets, setTargets] = useState<AzureTarget[]>([]);

  // add-target form
  const [connId, setConnId] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [region, setRegion] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deletingConnId, setDeletingConnId] = useState<string | null>(null);

  // verify
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, AzureSignalReport>>({});
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connections: AzureConnection[] }>(`${base}/connections`),
      api<{ targets: AzureTarget[] }>(`${base}/targets`),
    ])
      .then(([c, t]) => { setConnections(c.connections); setTargets(t.targets); setConnId(c.connections[0]?.id ?? ''); })
      .catch((e: { status?: number; message?: string }) => { if (e?.status !== 401) setError(e?.message ?? 'Failed to load Azure'); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function addTarget() {
    if (!connId || !subscriptionId.trim()) return;
    setAdding(true); setError('');
    try {
      const res = await api<{ target: AzureTarget }>(`${base}/targets`, {
        method: 'POST',
        body: JSON.stringify({ connectionId: connId, subscriptionId: subscriptionId.trim(), workspaceId: workspaceId.trim() || undefined, region: region.trim() || undefined }),
      });
      setTargets((prev) => [res.target, ...prev]);
      setSubscriptionId(''); setWorkspaceId(''); setRegion('');
    } catch (e) { setError(errMsg(e, 'Failed to add subscription')); }
    finally { setAdding(false); }
  }

  async function removeTarget(id: string) {
    setRemoving(id); setError('');
    try { await api<void>(`${base}/targets/${id}`, { method: 'DELETE' }); setTargets((prev) => prev.filter((t) => t.id !== id)); }
    catch (e) { setError(errMsg(e, 'Failed to remove')); }
    finally { setRemoving(null); }
  }

  async function verify(c: AzureConnection) {
    setVerifyingId(c.id); setVerifyErrors((p) => ({ ...p, [c.id]: '' }));
    try {
      const res = await api<{ report: AzureSignalReport; availableSignals: string[] }>(`${base}/connections/${c.id}/verify`, { method: 'POST' });
      setReports((p) => ({ ...p, [c.id]: res.report }));
      setReportOpenId(c.id);
      const avail = SIGNALS.filter((s) => res.report[s]?.ok);
      setConnections((prev) => prev.map((x) => x.id === c.id ? { ...x, lastTestOk: avail.length > 0, lastTestedAt: new Date().toISOString(), metadata: { ...x.metadata, availableSignals: avail } } : x));
    } catch (e) { setVerifyErrors((p) => ({ ...p, [c.id]: errMsg(e, 'Verification failed') })); }
    finally { setVerifyingId(null); }
  }

  async function deleteConnection(c: AzureConnection) {
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

  function onConnectionCreated(conn: AzureConnection) {
    setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [conn, ...prev]));
    setConnId(conn.id);
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">Azure</h2>
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
              <IntegrationHero provider="azure">
                <div className="mx-auto flex max-w-xl flex-col gap-3 text-left">
                  <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                  <p className="text-xs text-fg-faint">
                    Connections you add here are private to this project. Org-shared connections are managed{' '}
                    <a href="/admin/azure" className="text-accent hover:underline">at the org level</a>.
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
                        <Badge>{c.mode === 'workload_identity' ? 'Workload identity' : 'Service principal'}</Badge>
                        {c.projectId !== null && <Badge>Private</Badge>}
                        {c.defaultSubscriptionId && <span className="font-mono text-xs text-fg-faint">{c.defaultSubscriptionId}</span>}
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
                      <SignalPills sections={AZURE_SECTIONS} available={c.metadata.availableSignals} checked={!!c.lastTestedAt}
                        errors={reports[c.id] ? Object.fromEntries(SIGNALS.map((s) => [s, reports[c.id]![s]?.error])) : undefined} />
                    </div>
                  ))}
                </div>
                <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                <p className="text-xs text-fg-faint">
                  Connections you add here are private to this project. Org-shared connections are managed{' '}
                  <a href="/admin/azure" className="text-accent hover:underline">at the org level</a>.
                </p>
              </div>
            )}
          </section>

          {/* Scope = subscription/workspace targets */}
          {connections.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">The Azure subscriptions (and Log Analytics workspaces) assistants can query.</p>
              </div>

              {targets.length > 0 && (
                <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                  {targets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-mono text-sm text-fg">{t.subscriptionId}</span>
                        {(t.logAnalyticsWorkspaceId || t.region) && (
                          <span className="truncate font-mono text-xs text-fg-faint">
                            {t.logAnalyticsWorkspaceId ? `workspace ${t.logAnalyticsWorkspaceId}` : 'no workspace'}{t.region ? ` · ${t.region}` : ''}
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
                  <Field label="Subscription ID">
                    <Input className="font-mono" value={subscriptionId} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => setSubscriptionId(e.target.value)} />
                  </Field>
                  <Field label="Log Analytics workspace ID (optional)">
                    <Input className="font-mono" value={workspaceId} placeholder="workspace GUID — enables logs & traces" onChange={(e) => setWorkspaceId(e.target.value)} />
                  </Field>
                  <Field label="Region (optional)">
                    <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                      <option value="">Any region</option>
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={adding || !connId || !subscriptionId.trim()} onClick={addTarget}>{adding ? 'Adding…' : 'Add subscription'}</Button>
                  <p className="text-xs text-fg-faint">A Log Analytics workspace is required for logs and Application Insights traces.</p>
                </div>
              </div>
            </section>
          )}

          <SignalReportModal
            open={reportOpenId !== null}
            onClose={() => setReportOpenId(null)}
            title={`${connections.find((c) => c.id === reportOpenId)?.name ?? 'Connection'} — verification report`}
            sections={AZURE_SECTIONS}
            report={reportOpenId ? reports[reportOpenId] ?? null : null}
            checkedAt={connections.find((c) => c.id === reportOpenId)?.lastTestedAt}
          />
        </>
      )}
    </div>
  );
}

/** Inline form to create a project-OWNED Azure connection (private to this project).
 *  No auto-bind — the admin then verifies + adds targets as usual. */
function AddConnectionForm({ slug, onCreated }: { slug: string; onCreated: (c: AzureConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<AzureMode>('service_principal');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [defaultSubscriptionId, setDefaultSubscriptionId] = useState('');
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const canSave = !!name.trim() && !!tenantId.trim() && !!clientId.trim() && !!defaultSubscriptionId.trim() &&
    (mode === 'workload_identity' || !!clientSecret.trim()) && !saving;

  async function add() {
    setSaving(true); setErr('');
    try {
      const body: Record<string, unknown> = {
        name: name.trim(), mode, tenantId: tenantId.trim(), clientId: clientId.trim(),
        defaultSubscriptionId: defaultSubscriptionId.trim(), defaultWorkspaceId: defaultWorkspaceId.trim() || undefined,
      };
      if (mode === 'service_principal') body.clientSecret = clientSecret;
      const res = await api<{ connection: AzureConnection }>(`/api/org/projects/${slug}/azure/connections`, {
        method: 'POST', body: JSON.stringify(body),
      });
      onCreated(res.connection);
      setOpen(false);
      setName(''); setMode('service_principal'); setTenantId(''); setClientId(''); setClientSecret(''); setDefaultSubscriptionId(''); setDefaultWorkspaceId('');
    } catch (e) {
      setErr(errMsg(e, 'Failed to add connection'));
    } finally { setSaving(false); }
  }

  if (!open) return (<div><Button variant="secondary" onClick={() => setOpen(true)}>Add a connection</Button></div>);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add a connection</h4>
      <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
      <AzureCredsForm
        mode={mode} onModeChange={setMode}
        tenantId={tenantId} onTenantIdChange={setTenantId}
        clientId={clientId} onClientIdChange={setClientId}
        clientSecret={clientSecret} onClientSecretChange={setClientSecret}
        defaultSubscriptionId={defaultSubscriptionId} onDefaultSubscriptionIdChange={setDefaultSubscriptionId}
        defaultWorkspaceId={defaultWorkspaceId} onDefaultWorkspaceIdChange={setDefaultWorkspaceId}
      />
      {err && <p className="text-sm text-crit">{err}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={!canSave} onClick={add}>{saving ? 'Adding…' : 'Add connection'}</Button>
        <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
