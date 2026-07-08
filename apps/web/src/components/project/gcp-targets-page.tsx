'use client';

import { useEffect, useState } from 'react';
import { api, type GcpConnection, type GcpSignal, type GcpSignalReport, type GcpTarget } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Badge } from '../ui/badge';
import { Input, Select } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { CloudflarePicker, type PickerItem } from './cloudflare-picker';
import { GcpStepInstructions } from './gcp-step-instructions';
import { SignalPills, type SignalSection } from '../ui/signal-pills';
import { SignalReportModal } from '../ui/signal-report-modal';

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

const SIGNALS: GcpSignal[] = ['monitoring', 'logging', 'trace', 'errors'];
const GCP_SECTIONS: SignalSection[] = [
  { key: 'monitoring', label: 'Metrics' },
  { key: 'logging', label: 'Logs' },
  { key: 'trace', label: 'Traces' },
  { key: 'errors', label: 'Errors' },
];

/** A calm note shown when live project discovery is unavailable (e.g. the
 *  service account lacks roles/browser) — the user enters the GCP project id
 *  manually instead. */
function DiscoveryFallbackNote({ err }: { err: string }) {
  return (
    <p className="text-xs text-fg-faint">
      Couldn’t list projects automatically ({err}). Grant{' '}
      <span className="font-mono text-fg">roles/browser</span> to the connection’s service account
      to enable the picker, or enter a project ID manually:
    </p>
  );
}

export function GcpTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/gcp`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [connection, setConnection] = useState<GcpConnection | null>(null);
  const [connections, setConnections] = useState<GcpConnection[]>([]);
  const [targets, setTargets] = useState<GcpTarget[]>([]);

  // ── connection section state ──────────────────────────────────────
  const [pickConnId, setPickConnId] = useState('');
  const [binding, setBinding] = useState(false);

  // ── verify state ──────────────────────────────────────────────────
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<GcpSignalReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  // ── scope section state ───────────────────────────────────────────
  // When the user clicks "Restrict to specific projects" with no targets yet,
  // we switch to the Specific view locally before any target exists.
  const [restricting, setRestricting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const unrestricted = targets.length === 0;
  const showSpecific = !unrestricted || restricting;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connection: GcpConnection | null }>(`${base}/connection`),
      api<{ connections: GcpConnection[] }>(`${base}/connections`),
    ])
      .then(([c, list]) => {
        setConnection(c.connection);
        setConnections(list.connections);
        setPickConnId(c.connection?.id ?? list.connections[0]?.id ?? '');
        return c.connection ? loadTargets() : Promise.resolve();
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return; // api() redirects
        setError(e?.message ?? 'Failed to load Google Cloud');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function loadTargets() {
    const t = await api<{ targets: GcpTarget[] }>(`${base}/targets`);
    setTargets(t.targets);
    setRestricting(false);
  }

  // ── connection actions ────────────────────────────────────────────
  async function bind(connectionId: string) {
    if (!connectionId) return;
    setBinding(true);
    setError('');
    try {
      const res = await api<{ connection: GcpConnection }>(`${base}/connection`, {
        method: 'PUT',
        body: JSON.stringify({ connectionId }),
      });
      setConnection(res.connection);
      await loadTargets(); // switching connections clears scope server-side
    } catch (e) {
      setError(errMsg(e, 'Failed to set connection'));
    } finally {
      setBinding(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this Google Cloud connection? This clears the project’s scope.')) return;
    setBinding(true);
    setError('');
    try {
      await api<void>(`${base}/connection`, { method: 'DELETE' });
      setConnection(null);
      setTargets([]);
      setRestricting(false);
      setPickConnId(connections[0]?.id ?? '');
    } catch (e) {
      setError(errMsg(e, 'Failed to disconnect'));
    } finally {
      setBinding(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setVerifyError('');
    setReport(null);
    try {
      const res = await api<{ report: GcpSignalReport; availableSignals: string[] }>(
        `${base}/connection/verify`,
        { method: 'POST' },
      );
      setReport(res.report);
      setReportOpen(true);
      const avail = SIGNALS.filter((s) => res.report[s]?.ok);
      setConnection((prev) =>
        prev
          ? {
              ...prev,
              lastTestOk: avail.length > 0,
              lastTestedAt: new Date().toISOString(),
              metadata: { ...prev.metadata, availableSignals: avail },
            }
          : prev,
      );
    } catch (e) {
      setVerifyError(errMsg(e, 'Verification failed'));
    } finally {
      setVerifying(false);
    }
  }

  // ── scope actions ─────────────────────────────────────────────────
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
    if (
      !window.confirm(
        `Make scope unrestricted? This removes the ${targets.length} selected project(s).`,
      )
    )
      return;
    setError('');
    try {
      await Promise.all(
        targets.map((t) => api<void>(`${base}/targets/${t.id}`, { method: 'DELETE' })),
      );
      setTargets([]);
      setRestricting(false);
    } catch (e) {
      setError(errMsg(e, 'Failed to clear projects'));
    }
  }

  function onAdded(t: GcpTarget) {
    setTargets((prev) => [t, ...prev]);
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">Google Cloud</h2>

      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? (
        <Skeleton rows={4} />
      ) : (
        <>
          {/* ── Section 1 — Connection ──────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">Connection</h3>
              <p className="text-sm text-fg-muted">The Google Cloud connection this project uses.</p>
            </div>

            {connection ? (
              <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-fg">{connection.name}</span>
                    {connection.metadata.defaultGcpProjectId && (
                      <span className="font-mono text-xs text-fg-faint">
                        {connection.metadata.defaultGcpProjectId}
                      </span>
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
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="secondary"
                          disabled={binding || pickConnId === connection.id}
                          onClick={() => bind(pickConnId)}
                        >
                          Change
                        </Button>
                      </div>
                    )}
                    <Button variant="ghost" disabled={verifying} onClick={verify}>
                      {verifying ? 'Verifying…' : 'Verify'}
                    </Button>
                    {report && (
                      <Button variant="ghost" onClick={() => setReportOpen(true)}>
                        View report
                      </Button>
                    )}
                    <Button variant="ghost" disabled={binding} onClick={disconnect}>
                      Disconnect
                    </Button>
                  </div>
                </div>
                {connection.lastTestedAt && (
                  <p className="text-xs text-fg-faint">
                    Checked {new Date(connection.lastTestedAt).toLocaleString()} ·{' '}
                    {connection.lastTestOk === false ? 'Failed' : 'OK'}
                  </p>
                )}
                {verifyError && <p className="text-sm text-crit">{verifyError}</p>}
                <SignalPills
                  sections={GCP_SECTIONS}
                  available={connection.metadata.availableSignals}
                  checked={!!connection.lastTestedAt}
                  errors={report ? Object.fromEntries(SIGNALS.map((s) => [s, report[s]?.error])) : undefined}
                />
                <SignalReportModal
                  open={reportOpen}
                  onClose={() => setReportOpen(false)}
                  title={`${connection.name} — verification report`}
                  sections={GCP_SECTIONS}
                  report={report}
                  checkedAt={connection.lastTestedAt}
                />
              </div>
            ) : connections.length === 0 ? (
              <IntegrationHero provider="gcp">
                <div className="mx-auto max-w-xl text-left flex flex-col gap-4">
                  <div className="flex justify-center">
                    <Button onClick={() => { window.location.href = '/admin/gcp'; }}>Add a connection at the org level</Button>
                  </div>
                  <GcpStepInstructions />
                </div>
              </IntegrationHero>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Select
                  className="w-72"
                  value={pickConnId}
                  disabled={binding}
                  onChange={(e) => setPickConnId(e.target.value)}
                  aria-label="Connection"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button disabled={binding || !pickConnId} onClick={() => bind(pickConnId)}>
                  {binding ? 'Connecting…' : 'Use connection'}
                </Button>
              </div>
            )}
          </section>

          {/* ── Section 2 — Scope (only with a connection) ──────────── */}
          {connection && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-fg">Scope</h3>
                <p className="text-sm text-fg-muted">Which GCP projects assistants can query.</p>
              </div>

              {/* All vs Specific toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={makeUnrestricted}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    !showSpecific
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-edge text-fg-muted hover:bg-raised'
                  }`}
                >
                  All projects
                </button>
                <button
                  type="button"
                  onClick={() => setRestricting(true)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    showSpecific
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-edge text-fg-muted hover:bg-raised'
                  }`}
                >
                  Specific projects
                </button>
              </div>

              {!showSpecific ? (
                <div className="flex flex-col items-start gap-3 rounded-card border border-edge bg-surface p-5">
                  <p className="text-sm text-fg-muted">
                    Assistants can query any GCP project this connection’s service account can
                    access.
                  </p>
                  <Button variant="secondary" onClick={() => setRestricting(true)}>
                    Restrict to specific projects
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {targets.length > 0 && (
                    <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                      {targets.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between gap-3 px-5 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="truncate font-mono text-sm text-fg">
                              {t.gcpProjectId}
                            </span>
                            {t.label && <Badge>{t.label}</Badge>}
                          </div>
                          <Button
                            variant="ghost"
                            disabled={removing === t.id}
                            onClick={() => removeTarget(t.id)}
                          >
                            {removing === t.id ? 'Removing…' : 'Remove'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <AddGcpProjectForm
                    base={base}
                    connection={connection}
                    targets={targets}
                    onAdded={onAdded}
                  />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Inline form to add ONE allowed GCP project to the scope. Project identity
 *  uses discovery with a manual fallback when the service account can't list
 *  projects. A free-text role label is optional. */
function AddGcpProjectForm({
  base,
  connection,
  targets,
  onAdded,
}: {
  base: string;
  connection: GcpConnection;
  targets: GcpTarget[];
  onAdded: (t: GcpTarget) => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [label, setLabel] = useState('');
  const [manual, setManual] = useState(false);

  const [projects, setProjects] = useState<PickerItem[] | null>(null);
  const [projectsErr, setProjectsErr] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Discover the projects this connection's service account can reach.
  useEffect(() => {
    setProjects(null);
    setProjectsErr('');
    api<{ result: { id: string; name: string }[] }>(
      `${base}/discovery/projects?connectionId=${encodeURIComponent(connection.id)}`,
    )
      .then((r) => setProjects(r.result.map((p) => ({ id: p.id, name: p.name }))))
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setProjectsErr(e?.message ?? 'Failed to load projects');
        setManual(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id]);

  // Projects already in the scope — used to block dupes and hide them from the picker.
  const addedIds = new Set(targets.map((t) => t.gcpProjectId));
  const isDuplicate = !!projectId && addedIds.has(projectId);

  const canAdd = !!projectId.trim() && !isDuplicate && !saving;

  function pickProject(id: string) {
    setProjectId(id);
  }

  async function add() {
    setSaving(true);
    setSaveError('');
    try {
      const body: Record<string, unknown> = { gcpProjectId: projectId.trim() };
      if (label.trim()) body.label = label.trim();
      const res = await api<{ target: GcpTarget }>(`${base}/targets`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onAdded(res.target);
      setProjectId('');
      setLabel('');
    } catch (e) {
      setSaveError(errMsg(e, 'Failed to add project'));
    } finally {
      setSaving(false);
    }
  }

  const showManual = manual || !!projectsErr;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add GCP project</h4>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-muted">GCP project</span>
        {showManual ? (
          <>
            {projectsErr ? (
              <DiscoveryFallbackNote err={projectsErr} />
            ) : (
              <p className="text-xs text-fg-faint">Enter the GCP project ID:</p>
            )}
            <Input
              className="font-mono"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value.trim())}
              placeholder="GCP project ID (e.g. acme-prod)"
            />
          </>
        ) : (
          <>
            <CloudflarePicker
              items={(projects ?? []).filter((p) => !addedIds.has(p.id))}
              selected={projectId ? [projectId] : []}
              onToggle={pickProject}
              loading={projects === null}
              placeholder="Search projects…"
              emptyText="All projects are already in the scope"
            />
            <button
              type="button"
              className="self-start text-xs text-accent underline"
              onClick={() => setManual(true)}
            >
              Enter a project ID manually
            </button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-muted">Role label (optional)</span>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. production, payments-team"
        />
      </div>

      {saveError && <p className="text-sm text-crit">{saveError}</p>}
      <div className="flex items-center justify-end gap-3">
        {isDuplicate && (
          <span className="text-sm text-fg-muted">This GCP project is already in the scope.</span>
        )}
        <Button disabled={!canAdd} onClick={add}>
          {saving ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}
