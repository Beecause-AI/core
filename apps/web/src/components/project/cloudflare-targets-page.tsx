'use client';

import { useEffect, useState } from 'react';
import { api, type CloudflareConnection, type CloudflareSignal, type CloudflareSignalReport, type CloudflareTarget } from '../../lib/api';
import { Button } from '../ui/button';
import { IntegrationHero } from '../ui/integration-hero';
import { Badge } from '../ui/badge';
import { Input, Select } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { CloudflarePicker, type PickerItem } from './cloudflare-picker';
import { friendlyCloudflareError } from './cloudflare-signal-report';
import { Modal } from '../ui/modal';
import { SignalPills, type SignalSection } from '../ui/signal-pills';

type Kind = 'account' | 'zone';

const SIGNALS: CloudflareSignal[] = ['analytics', 'logs', 'workers'];
const CF_SECTIONS: SignalSection[] = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'logs', label: 'Logs' },
  { key: 'workers', label: 'Workers' },
];

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** A calm note shown when live discovery is unavailable (e.g. the token lacks
 *  the REST listing permission) — the user enters the value manually instead,
 *  with a link explaining which token permissions enable auto-listing. */
function DiscoveryFallbackNote({ err }: { err: string }) {
  const [help, setHelp] = useState(false);
  return (
    <>
      <p className="text-xs text-fg-faint">
        Couldn’t list these automatically ({friendlyCloudflareError(err)}).{' '}
        <button type="button" className="text-accent underline" onClick={() => setHelp(true)}>
          How to enable auto-listing
        </button>
        . Enter manually:
      </p>
      <Modal open={help} onClose={() => setHelp(false)} title="Enable Cloudflare auto-listing">
        <div className="flex flex-col gap-3 text-sm text-fg-muted">
          <p>
            Listing accounts and zones uses Cloudflare’s REST API, which needs read permissions a
            least-privilege analytics token doesn’t include. Querying analytics, logs, and Workers
            for RCA still works without them — you can always enter the ID manually.
          </p>
          <p className="text-fg">
            To enable the pickers, edit the API token (Cloudflare dashboard → Manage Account →
            Account API Tokens → your token → Edit) and add these read permissions:
          </p>
          <ul className="list-disc pl-5">
            <li><span className="text-fg font-medium">Zone · Zone: Read</span> — list zones</li>
            <li><span className="text-fg font-medium">Account · Account Settings: Read</span> — list accounts</li>
          </ul>
          <p>
            Save the token, then reopen this page. These are optional — pasting the ID below works
            the same for RCA queries.
          </p>
          <div className="flex justify-end">
            <a
              className="text-accent underline"
              href="https://dash.cloudflare.com/?to=/:account/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              Open API Tokens →
            </a>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function CloudflareTargetsPage({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/cloudflare`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [connection, setConnection] = useState<CloudflareConnection | null>(null);
  const [connections, setConnections] = useState<CloudflareConnection[]>([]);
  const [targets, setTargets] = useState<CloudflareTarget[]>([]);

  // ── connection section state ──────────────────────────────────────
  const [pickConnId, setPickConnId] = useState('');
  const [binding, setBinding] = useState(false);

  // ── verify state ──────────────────────────────────────────────────
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<CloudflareSignalReport | null>(null);
  const [verifyError, setVerifyError] = useState('');

  // ── scope section state ───────────────────────────────────────────
  // When the user clicks "Restrict to specific resources" with no targets yet,
  // we switch to the Specific view locally before any target exists.
  const [restricting, setRestricting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const unrestricted = targets.length === 0;
  const showSpecific = !unrestricted || restricting;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ connection: CloudflareConnection | null }>(`${base}/connection`),
      api<{ connections: CloudflareConnection[] }>(`${base}/connections`),
    ])
      .then(([c, list]) => {
        setConnection(c.connection);
        setConnections(list.connections);
        setPickConnId(c.connection?.id ?? list.connections[0]?.id ?? '');
        return c.connection ? loadTargets() : Promise.resolve();
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return; // api() redirects
        setError(e?.message ?? 'Failed to load Cloudflare');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function loadTargets() {
    const t = await api<{ targets: CloudflareTarget[] }>(`${base}/targets`);
    setTargets(t.targets);
    setRestricting(false);
  }

  // ── connection actions ────────────────────────────────────────────
  async function bind(connectionId: string) {
    if (!connectionId) return;
    setBinding(true);
    setError('');
    try {
      const res = await api<{ connection: CloudflareConnection }>(`${base}/connection`, {
        method: 'PUT',
        body: JSON.stringify({ connectionId }),
      });
      setConnection(res.connection);
      await loadTargets(); // switching connections clears resources server-side
    } catch (e) {
      setError(errMsg(e, 'Failed to set connection'));
    } finally {
      setBinding(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this Cloudflare connection? This clears the project’s scope.')) return;
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
      const res = await api<{ report: CloudflareSignalReport; availableSignals: string[] }>(
        `${base}/connection/verify`,
        { method: 'POST' },
      );
      setReport(res.report);
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
      setError(errMsg(e, 'Failed to remove resource'));
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
        `Make scope unrestricted? This removes the ${targets.length} selected resource(s).`,
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
      setError(errMsg(e, 'Failed to clear resources'));
    }
  }

  function onAdded(t: CloudflareTarget) {
    setTargets((prev) => [t, ...prev]);
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">Cloudflare</h2>

      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? (
        <Skeleton rows={4} />
      ) : (
        <>
          {/* ── Section 1 — Connection ──────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">Connection</h3>
              <p className="text-sm text-fg-muted">The Cloudflare connection this project uses.</p>
            </div>

            {connection ? (
              <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-fg">{connection.name}</span>
                    {connection.metadata.accountId && (
                      <span className="font-mono text-xs text-fg-faint">{connection.metadata.accountId}</span>
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
                  sections={CF_SECTIONS}
                  available={connection.metadata.availableSignals}
                  checked={!!connection.lastTestedAt}
                  errors={report ? Object.fromEntries(SIGNALS.map((s) => [s, report[s]?.error])) : undefined}
                />
              </div>
            ) : connections.length === 0 ? (
              <IntegrationHero provider="cloudflare">
                <div className="flex justify-center">
                  <Button onClick={() => { window.location.href = '/admin/cloudflare'; }}>Add a connection at the org level</Button>
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
                <p className="text-sm text-fg-muted">Which resources assistants can query.</p>
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
                  All resources
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
                  Specific resources
                </button>
              </div>

              {!showSpecific ? (
                <div className="flex flex-col items-start gap-3 rounded-card border border-edge bg-surface p-5">
                  <p className="text-sm text-fg-muted">
                    Assistants can query any zone or account this connection can access.
                  </p>
                  <Button variant="secondary" onClick={() => setRestricting(true)}>
                    Restrict to specific resources
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
                            <span className="truncate font-mono text-sm text-fg">{t.name}</span>
                            <Badge>{t.kind}</Badge>
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

                  <AddResourceForm base={base} connection={connection} targets={targets} onAdded={onAdded} />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Inline form to add ONE allowed resource (account or zone) to the scope.
 *  Resource identity uses discovery with a manual fallback when the token
 *  can't list. When the connection pins an accountId, the account is known. */
function AddResourceForm({
  base,
  connection,
  targets,
  onAdded,
}: {
  base: string;
  connection: CloudflareConnection;
  targets: CloudflareTarget[];
  onAdded: (t: CloudflareTarget) => void;
}) {
  const connAccountId = connection.metadata.accountId ?? '';

  const [kind, setKind] = useState<Kind>('account');
  const [accountId, setAccountId] = useState(connAccountId);
  const [zoneId, setZoneId] = useState('');
  const [name, setName] = useState('');

  const [accounts, setAccounts] = useState<PickerItem[] | null>(null);
  const [accountsErr, setAccountsErr] = useState('');
  const [zones, setZones] = useState<PickerItem[] | null>(null);
  const [zonesErr, setZonesErr] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Keep the account pinned to the connection's account when it has one.
  useEffect(() => {
    if (connAccountId) {
      setAccountId(connAccountId);
      setName((n) => (kind === 'account' && !n ? connection.name : n));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connAccountId, kind]);

  // Discover accounts only when the connection doesn't pin one.
  useEffect(() => {
    if (connAccountId) return;
    setAccounts(null);
    setAccountsErr('');
    api<{ result: { id: string; name: string }[] }>(
      `${base}/discovery/accounts?connectionId=${encodeURIComponent(connection.id)}`,
    )
      .then((r) => setAccounts(r.result.map((a) => ({ id: a.id, name: a.name }))))
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setAccountsErr(e?.message ?? 'Failed to load accounts');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, connAccountId]);

  // Discover zones once an account is known (zone kind only).
  useEffect(() => {
    if (kind !== 'zone' || !accountId) return;
    setZones(null);
    setZonesErr('');
    api<{ result: { id: string; name: string }[] }>(
      `${base}/discovery/zones?connectionId=${encodeURIComponent(
        connection.id,
      )}&accountId=${encodeURIComponent(accountId)}`,
    )
      .then((r) => setZones(r.result.map((z) => ({ id: z.id, name: z.name }))))
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setZonesErr(e?.message ?? 'Failed to load zones');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, accountId, kind]);

  function pickAccount(id: string) {
    setAccountId(id);
    setZoneId('');
    const item = accounts?.find((a) => a.id === id);
    if (kind === 'account' && item) setName(item.name);
  }

  function pickZone(id: string) {
    setZoneId(id);
    const item = zones?.find((z) => z.id === id);
    if (item) setName(item.name);
  }

  function setKindReset(k: Kind) {
    setKind(k);
    setAccountId(connAccountId || '');
    setZoneId('');
    setName('');
  }

  // Resources already in the scope — used to block dupes and hide them from pickers.
  const addedAccountIds = new Set(targets.filter((t) => t.kind === 'account').map((t) => t.accountId));
  const addedZoneIds = new Set(targets.filter((t) => t.kind === 'zone').map((t) => t.zoneId));
  const isDuplicate =
    kind === 'account' ? addedAccountIds.has(accountId) : !!zoneId && addedZoneIds.has(zoneId);

  const identityReady = kind === 'account' ? !!accountId : !!accountId && !!zoneId;
  const canAdd =
    identityReady && (kind === 'zone' ? !!name.trim() : true) && !isDuplicate && !saving;

  async function add() {
    setSaving(true);
    setSaveError('');
    try {
      const scopeName =
        kind === 'zone' ? name.trim() : name.trim() || connection.name || accountId;
      const body: Record<string, unknown> = { kind, accountId, name: scopeName };
      if (kind === 'zone') body.zoneId = zoneId;
      const res = await api<{ target: CloudflareTarget }>(`${base}/targets`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onAdded(res.target);
      // reset
      setZoneId('');
      setName(connAccountId && kind === 'account' ? connection.name : '');
      if (kind === 'zone') setZones(null);
    } catch (e) {
      setSaveError(errMsg(e, 'Failed to add resource'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-edge bg-surface p-5">
      <h4 className="text-sm font-semibold text-fg">Add resource</h4>

      {/* Kind */}
      <div className="flex gap-1">
        {(
          [
            ['account', 'Account'],
            ['zone', 'Zone'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindReset(k)}
            className={`rounded-md px-3 py-1 text-sm ${
              kind === k ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-raised'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Account */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-muted">Account</span>
        {connAccountId ? (
          <p className="font-mono text-sm text-fg-faint">{connAccountId}</p>
        ) : accountsErr || accounts?.length === 0 ? (
          <>
            {accountsErr ? (
              <DiscoveryFallbackNote err={accountsErr} />
            ) : (
              <p className="text-xs text-fg-faint">
                No accounts listed for this connection — enter the account ID manually:
              </p>
            )}
            <Input
              className="font-mono"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value.trim())}
              placeholder="Account ID (32-char hex)"
            />
          </>
        ) : (
          <CloudflarePicker
            items={(accounts ?? []).filter((a) => kind === 'zone' || !addedAccountIds.has(a.id))}
            selected={accountId ? [accountId] : []}
            onToggle={pickAccount}
            loading={accounts === null}
            placeholder="Search accounts…"
            emptyText={kind === 'account' ? 'All accounts are already in the scope' : 'No accounts found'}
          />
        )}
      </div>

      {/* Zone (zone kind only) */}
      {kind === 'zone' && accountId && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Zone</span>
          {zonesErr || zones?.length === 0 ? (
            <>
              {zonesErr ? (
                <DiscoveryFallbackNote err={zonesErr} />
              ) : (
                <p className="text-xs text-fg-faint">
                  No zones listed for this connection — enter the zone ID and domain manually:
                </p>
              )}
              <Input
                className="font-mono"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value.trim())}
                placeholder="Zone ID (32-char hex)"
              />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="example.com"
              />
            </>
          ) : (
            <CloudflarePicker
              items={(zones ?? []).filter((z) => !addedZoneIds.has(z.id))}
              selected={zoneId ? [zoneId] : []}
              onToggle={pickZone}
              loading={zones === null}
              placeholder="Search zones…"
              emptyText="All zones are already in the scope"
            />
          )}
        </div>
      )}

      {saveError && <p className="text-sm text-crit">{saveError}</p>}
      <div className="flex items-center justify-end gap-3">
        {isDuplicate && (
          <span className="text-sm text-fg-muted">This {kind} is already in the scope.</span>
        )}
        <Button disabled={!canAdd} onClick={add}>
          {saving ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}
