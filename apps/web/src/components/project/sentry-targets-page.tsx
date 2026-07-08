'use client';

import { useEffect, useState } from 'react';
import { api, type SentryConnection, type SentryTarget, type SentryDiscoveredProject } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Input, Select, Field } from '../ui/input';
import { Skeleton } from '../ui/skeleton';

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export function SentryTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/sentry`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [connection, setConnection] = useState<SentryConnection | null>(null);
  const [connections, setConnections] = useState<SentryConnection[]>([]);
  const [targets, setTargets] = useState<SentryTarget[]>([]);

  const [pickConnId, setPickConnId] = useState('');
  const [binding, setBinding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'' | 'ok' | string>('');

  const [restricting, setRestricting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const unrestricted = targets.length === 0;
  const showSpecific = !unrestricted || restricting;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connection: SentryConnection | null }>(`${base}/connection`),
      api<{ connections: SentryConnection[] }>(`${base}/connections`),
    ])
      .then(([c, list]) => {
        setConnection(c.connection);
        setConnections(list.connections);
        setPickConnId(c.connection?.id ?? list.connections[0]?.id ?? '');
        return c.connection ? loadTargets() : Promise.resolve();
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setError(e?.message ?? 'Failed to load Sentry');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function loadTargets() {
    const t = await api<{ targets: SentryTarget[] }>(`${base}/targets`);
    setTargets(t.targets);
    setRestricting(false);
  }

  async function bind(connectionId: string) {
    if (!connectionId) return;
    setBinding(true);
    setError('');
    setTestResult('');
    try {
      const res = await api<{ connection: SentryConnection }>(`${base}/connection`, {
        method: 'PUT', body: JSON.stringify({ connectionId }),
      });
      setConnection(res.connection);
      await loadTargets();
    } catch (e) {
      setError(errMsg(e, 'Failed to set connection'));
    } finally {
      setBinding(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this Sentry connection? This clears the project’s scope.')) return;
    setBinding(true);
    setError('');
    try {
      await api<void>(`${base}/connection`, { method: 'DELETE' });
      setConnection(null);
      setTargets([]);
      setRestricting(false);
      setTestResult('');
      setPickConnId(connections[0]?.id ?? '');
    } catch (e) {
      setError(errMsg(e, 'Failed to disconnect'));
    } finally {
      setBinding(false);
    }
  }

  async function test() {
    if (!connection) return;
    setTesting(true);
    setTestResult('');
    try {
      const res = await fetch(`${base}/connection/test`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setTestResult(e.error ?? 'Test failed');
        return;
      }
      setTestResult('ok');
    } catch (e) {
      setTestResult(errMsg(e, 'Test failed'));
    } finally {
      setTesting(false);
    }
  }

  function onConnectionCreated(conn: SentryConnection) {
    setConnection(conn);
    setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [conn, ...prev]));
    setPickConnId(conn.id);
    setTargets([]);
    setRestricting(false);
    setTestResult('');
  }

  async function deleteOwnedConnection() {
    if (!connection) return;
    if (!window.confirm('Delete this project connection? This removes it and clears the project’s scope.')) return;
    setBinding(true);
    setError('');
    try {
      await api<void>(`${base}/connections/${connection.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((c) => c.id !== connection.id));
      setConnection(null);
      setTargets([]);
      setRestricting(false);
      setTestResult('');
      setPickConnId('');
    } catch (e) {
      setError(errMsg(e, 'Failed to delete connection'));
    } finally {
      setBinding(false);
    }
  }

  async function removeTarget(id: string) {
    setRemoving(id);
    setError('');
    try {
      await api<void>(`${base}/targets/${id}`, { method: 'DELETE' });
      setTargets((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(errMsg(e, 'Failed to remove project'));
    } finally {
      setRemoving(null);
    }
  }

  async function makeUnrestricted() {
    if (targets.length === 0) {
      setRestricting(false);
      return;
    }
    if (!window.confirm(`Make scope unrestricted? This removes the ${targets.length} selected project(s).`)) return;
    setError('');
    try {
      await Promise.all(targets.map((t) => api<void>(`${base}/targets/${t.id}`, { method: 'DELETE' })));
      setTargets([]);
      setRestricting(false);
    } catch (e) {
      setError(errMsg(e, 'Failed to clear projects'));
    }
  }

  function onAdded(t: SentryTarget) {
    setTargets((prev) => [t, ...prev]);
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">Sentry</h2>

      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? (
        <Skeleton rows={4} />
      ) : (
        <>
          {/* ── Connection ─────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">Connection</h3>
              <p className="text-sm text-fg-muted">The Sentry connection this project uses.</p>
            </div>

            {connection ? (
              <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-fg">{connection.name}</span>
                    {connection.metadata.sentryOrgSlug && (
                      <span className="font-mono text-xs text-fg-faint">{connection.metadata.sentryOrgSlug}</span>
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    {connections.length > 1 && (
                      <div className="flex items-end gap-2">
                        <Select
                          className="w-56"
                          value={pickConnId}
                          disabled={binding}
                          onChange={(e) => setPickConnId(e.target.value)}
                          aria-label="Change connection"
                        >
                          {connections.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                        <Button variant="secondary" disabled={binding || pickConnId === connection.id} onClick={() => bind(pickConnId)}>
                          Change
                        </Button>
                      </div>
                    )}
                    <Button variant="ghost" disabled={testing} onClick={test}>
                      {testing ? 'Testing…' : 'Test'}
                    </Button>
                    <Button variant="ghost" disabled={binding} onClick={disconnect}>Disconnect</Button>
                    {connection.projectId !== null && (
                      <Button variant="ghost" disabled={binding} onClick={deleteOwnedConnection}>Delete</Button>
                    )}
                  </div>
                </div>
                {connection.projectId !== null && (
                  <span className="text-xs text-fg-faint">Private to this project</span>
                )}
                {testResult === 'ok' && <p className="text-xs text-ok">Connection OK.</p>}
                {testResult && testResult !== 'ok' && <p className="text-sm text-crit">{testResult}</p>}
              </div>
            ) : connections.length === 0 ? (
              <IntegrationHero provider="sentry">
                <div className="mx-auto max-w-xl text-left flex flex-col gap-3">
                  <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                  <p className="text-xs text-fg-faint">
                    Connections you add here are private to this project. Org-shared connections are managed{' '}
                    <a href="/admin/sentry" className="text-accent hover:underline">at the org level</a>.
                  </p>
                </div>
              </IntegrationHero>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end gap-2">
                  <Select className="w-72" value={pickConnId} disabled={binding} onChange={(e) => setPickConnId(e.target.value)} aria-label="Connection">
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  <Button disabled={binding || !pickConnId} onClick={() => bind(pickConnId)}>
                    {binding ? 'Connecting…' : 'Use connection'}
                  </Button>
                </div>
                <AddConnectionForm slug={slug} onCreated={onConnectionCreated} />
                <p className="text-xs text-fg-faint">
                  Connections you add here are private to this project. Org-shared connections are managed{' '}
                  <a href="/admin/sentry" className="text-accent hover:underline">at the org level</a>.
                </p>
              </div>
            )}
          </section>

          {/* ── Scope ──────────────────────────────────────────────── */}
          {connection && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">Which Sentry projects assistants can query.</p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={makeUnrestricted}
                  className={`rounded-md border px-3 py-1.5 text-sm ${!showSpecific ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-fg-muted hover:bg-raised'}`}
                >
                  All projects
                </button>
                <button
                  type="button"
                  onClick={() => setRestricting(true)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${showSpecific ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-fg-muted hover:bg-raised'}`}
                >
                  Specific projects
                </button>
              </div>

              {!showSpecific ? (
                <div className="flex flex-col items-start gap-3 rounded-card border border-edge bg-surface p-5">
                  <p className="text-sm text-fg-muted">Assistants can query any project this connection’s token can access.</p>
                  <Button variant="secondary" onClick={() => setRestricting(true)}>Restrict to specific projects</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {targets.length > 0 && (
                    <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                      {targets.map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="truncate text-sm text-fg">{t.name}</span>
                            <span className="font-mono text-xs text-fg-faint">{t.sentryProjectSlug}</span>
                          </div>
                          <Button variant="ghost" disabled={removing === t.id} onClick={() => removeTarget(t.id)}>
                            {removing === t.id ? 'Removing…' : 'Remove'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <AddProjectForm base={base} connectionId={connection.id} targets={targets} onAdded={onAdded} />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Inline form to create a project-OWNED Sentry connection (private to this project)
 *  from the project page. Auto-binds on create (handled server-side). */
function AddConnectionForm({ slug, onCreated }: { slug: string; onCreated: (c: SentryConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const canSave = !!name.trim() && !!orgSlug.trim() && !!token.trim() && !saving;

  async function add() {
    setSaving(true);
    setErr('');
    try {
      const body: Record<string, unknown> = { name: name.trim(), sentryOrgSlug: orgSlug.trim(), authToken: token.trim() };
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      const res = await api<{ connection: SentryConnection }>(`/api/org/projects/${slug}/sentry/connections`, {
        method: 'POST', body: JSON.stringify(body),
      });
      onCreated(res.connection);
      setOpen(false);
      setName(''); setOrgSlug(''); setBaseUrl(''); setToken('');
    } catch (e) {
      setErr(errMsg(e, 'Failed to add connection'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>Add a connection</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add a connection</h4>
      <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Sentry organization slug"><Input className="font-mono" value={orgSlug} placeholder="acme" onChange={(e) => setOrgSlug(e.target.value)} /></Field>
      <Field label="Base URL (optional)"><Input className="font-mono" value={baseUrl} placeholder="https://sentry.io" onChange={(e) => setBaseUrl(e.target.value)} /></Field>
      <Field label="Auth token"><Input type="password" value={token} placeholder="sntrys_…" onChange={(e) => setToken(e.target.value)} /></Field>
      {err && <p className="text-sm text-crit">{err}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={!canSave} onClick={add}>{saving ? 'Adding…' : 'Add connection'}</Button>
        <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Inline form to add ONE allowed Sentry project to the scope. Uses discovery with a
 *  manual fallback when the token can't list the org's projects. */
function AddProjectForm({
  base, connectionId, targets, onAdded,
}: {
  base: string;
  connectionId: string;
  targets: SentryTarget[];
  onAdded: (t: SentryTarget) => void;
}) {
  const [discovered, setDiscovered] = useState<SentryDiscoveredProject[] | null>(null);
  const [discoveryErr, setDiscoveryErr] = useState('');

  const [slugSel, setSlugSel] = useState('');
  const [manualSlug, setManualSlug] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setDiscovered(null);
    setDiscoveryErr('');
    api<{ projects: SentryDiscoveredProject[] }>(`${base}/discovery/projects?connectionId=${encodeURIComponent(connectionId)}`)
      .then((r) => setDiscovered(r.projects))
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setDiscoveryErr(e?.message ?? 'Failed to list projects');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, connectionId]);

  const addedSlugs = new Set(targets.map((t) => t.sentryProjectSlug));
  const options = (discovered ?? []).filter((p) => !addedSlugs.has(p.slug));
  const manualMode = !!discoveryErr;

  const canAdd = manualMode
    ? !!manualSlug.trim() && !!manualId.trim() && !addedSlugs.has(manualSlug.trim()) && !saving
    : !!slugSel && !saving;

  async function add() {
    setSaving(true);
    setSaveError('');
    try {
      let body: Record<string, unknown>;
      if (manualMode) {
        body = { sentryProjectSlug: manualSlug.trim(), sentryProjectId: manualId.trim(), name: (manualName.trim() || manualSlug.trim()) };
      } else {
        const p = options.find((o) => o.slug === slugSel);
        if (!p) { setSaveError('Pick a project'); setSaving(false); return; }
        body = { sentryProjectSlug: p.slug, sentryProjectId: p.id, name: p.name };
      }
      const res = await api<{ target: SentryTarget }>(`${base}/targets`, { method: 'POST', body: JSON.stringify(body) });
      onAdded(res.target);
      setSlugSel('');
      setManualSlug(''); setManualId(''); setManualName('');
    } catch (e) {
      setSaveError(errMsg(e, 'Failed to add project'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add project</h4>

      {manualMode ? (
        <>
          <p className="text-xs text-fg-faint">Couldn’t list projects automatically ({discoveryErr}). Enter the project manually:</p>
          <div className="flex flex-col gap-2">
            <Input className="font-mono" value={manualSlug} onChange={(e) => setManualSlug(e.target.value.trim())} placeholder="Project slug (e.g. web)" />
            <Input className="font-mono" value={manualId} onChange={(e) => setManualId(e.target.value.trim())} placeholder="Project ID (numeric)" />
            <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Display name (optional)" />
          </div>
        </>
      ) : (
        <Select value={slugSel} disabled={discovered === null} onChange={(e) => setSlugSel(e.target.value)} aria-label="Sentry project">
          <option value="">{discovered === null ? 'Loading…' : options.length === 0 ? 'All projects already in scope' : 'Select a project…'}</option>
          {options.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
          ))}
        </Select>
      )}

      {saveError && <p className="text-sm text-crit">{saveError}</p>}
      <div className="flex items-center justify-end">
        <Button disabled={!canAdd} onClick={add}>{saving ? 'Adding…' : 'Add'}</Button>
      </div>
    </div>
  );
}
