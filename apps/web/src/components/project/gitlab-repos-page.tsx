'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getProjectSettings, setProjectIssuesEnabled, type CatalogResponse, type CatalogRepo, type CatalogSync, type ProjectRepo } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';

const PROVIDER = '/api/org/integrations/gitlab/catalog';

function syncedLabel(sync: CatalogSync): string {
  if (sync.status === 'syncing') return `Syncing from GitLab… ${sync.repoCount} found`;
  if (sync.status === 'error') return `Sync failed: ${sync.error ?? 'unknown error'}`;
  if (!sync.finishedAt) return 'Not synced yet';
  const mins = Math.max(0, Math.round((Date.now() - new Date(sync.finishedAt).getTime()) / 60000));
  return mins < 1 ? 'Synced just now' : `Synced ${mins}m ago`;
}

export function GitlabReposPage({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [rows, setRows] = useState<CatalogRepo[]>([]);
  const [selected, setSelected] = useState<ProjectRepo[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [issuesEnabled, setIssuesEnabled] = useState(false);
  const [issuesOrgEnabled, setIssuesOrgEnabled] = useState(false);
  const [issuesBusy, setIssuesBusy] = useState(false);
  const [issuesError, setIssuesError] = useState('');
  const polling = useRef(false);
  const qRef = useRef(q);
  useEffect(() => { qRef.current = q; }, [q]);
  const firstSearch = useRef(true);
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);

  const inScope = new Set((selected ?? []).map((r) => r.repoFullName));

  // Load a query page (cursor null = first page, replaces rows).
  async function load(query: string, cursor: string | null) {
    const url = `${PROVIDER}?q=${encodeURIComponent(query)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&limit=50`;
    const res = await api<CatalogResponse>(url);
    if (unmountedRef.current) return res;
    setData(res);
    setRows((prev) => (cursor ? [...prev, ...res.repos] : res.repos));
    return res;
  }

  // Drive the sync to completion one page per ~1s, refreshing the current view.
  async function poll() {
    if (polling.current) return;
    polling.current = true;
    try {
      let done = false;
      while (!done) {
        const r = await api<{ status: string; repoCount: number; done: boolean }>(`${PROVIDER}/sync`, { method: 'POST' });
        if (unmountedRef.current) { polling.current = false; return; }
        await load(qRef.current, null); // refresh visible rows + sync banner as repos land
        if (unmountedRef.current) { polling.current = false; return; }
        done = r.done;
        if (!done) await new Promise((res) => setTimeout(res, 1000));
        if (unmountedRef.current) { polling.current = false; return; }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      polling.current = false;
    }
  }

  // Initial load + selected repos; kick a sync if stale/never-synced.
  useEffect(() => {
    Promise.all([
      load('', null),
      api<ProjectRepo[]>(`/api/org/projects/${slug}/gitlab-repos`),
      getProjectSettings(slug),
    ])
      .then(([res, scope, settings]) => {
        setSelected(scope);
        setIssuesEnabled(settings.issuesEnabled);
        setIssuesOrgEnabled(settings.issuesOrgEnabledGitlab);
        if (res.sync.status === 'syncing' || res.sync.stale) void poll();
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 401) return;
        setSelected([]);
        setError(e?.status === 422 ? 'Connect GitLab under Admin → Integrations first.' : (e?.message ?? 'Failed to load'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Debounced search.
  useEffect(() => {
    if (firstSearch.current) { firstSearch.current = false; return; }
    const id = setTimeout(() => { void load(qRef.current, null).catch(() => {}); }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function add(repoFullName: string) {
    setAdding(repoFullName); setError('');
    try {
      const repo = await api<ProjectRepo>(`/api/org/projects/${slug}/gitlab-repos`, { method: 'POST', body: JSON.stringify({ repoFullName }) });
      setSelected((s) => [repo, ...(s ?? [])]);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError(err?.status === 409 ? 'Already in scope.' : (err?.message ?? 'Failed to add'));
    } finally { setAdding(null); }
  }

  async function remove(repo: ProjectRepo) {
    setRemoving(repo.id); setError('');
    try {
      await api<void>(`/api/org/projects/${slug}/gitlab-repos/${repo.id}`, { method: 'DELETE' });
      setSelected((s) => (s ?? []).filter((r) => r.id !== repo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally { setRemoving(null); }
  }

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try { await load(q, data.nextCursor); } finally { setLoadingMore(false); }
  }

  async function refresh() {
    setError('');
    try { await api<unknown>(`${PROVIDER}/refresh`, { method: 'POST' }); await load(q, null); void poll(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Refresh failed'); }
  }

  async function toggleIssues(value: boolean) {
    setIssuesBusy(true); setIssuesError('');
    const prev = issuesEnabled;
    setIssuesEnabled(value);
    try {
      await setProjectIssuesEnabled(slug, value);
    } catch (e) {
      setIssuesEnabled(prev);
      setIssuesError((e as { message?: string })?.message ?? 'Failed to update');
    } finally { setIssuesBusy(false); }
  }

  const manualValid = /^[^/\s]+\/[^/\s]+$/.test(q.trim());
  const exactShown = rows.some((r) => r.repoFullName.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-fg">GitLab repositories</h2>

      {error && <p className="text-sm text-crit">{error}</p>}

      {/* ── Section 1 — Selected repositories ─────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-fg">Selected repositories</h3>
          <p className="text-sm text-fg-muted">Repositories assistants in this project can read.</p>
        </div>

        {selected === null ? (
          <Skeleton rows={3} />
        ) : selected.length === 0 ? (
          <EmptyState title="No repositories selected" body="Add repositories below to give this project's assistants access." />
        ) : (
          <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
            {selected.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex-1 truncate font-mono text-sm text-fg">{r.repoFullName}</span>
                {r.defaultBranch && <span className="font-mono text-xs text-fg-faint">{r.defaultBranch}</span>}
                <Button variant="ghost" disabled={removing === r.id} onClick={() => remove(r)}>
                  {removing === r.id ? 'Removing…' : 'Remove'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2 — GitLab issues ──────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-fg">GitLab issues</h3>
          <p className="text-sm text-fg-muted">Let the Slack assistant offer to raise a GitLab issue after a fixable RCA.</p>
        </div>

        <div className="rounded-card border border-edge bg-surface px-5 py-4 flex flex-col gap-3">
          {/* GitLab issue creation (project opt-in; gated by the org master switch). */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <span className={`text-sm font-medium${issuesOrgEnabled ? '' : ' opacity-40'}`}>GitLab issue creation</span>
              <span className={`text-xs text-fg-faint${issuesOrgEnabled ? '' : ' opacity-40'}`}>Enable per project once the org master switch is on.</span>
            </div>
            <Button
              variant={issuesEnabled ? 'secondary' : 'ghost'}
              disabled={issuesBusy || !issuesOrgEnabled}
              onClick={() => void toggleIssues(!issuesEnabled)}
            >{issuesEnabled ? 'On' : 'Off'}</Button>
          </div>
          {!issuesOrgEnabled && (
            <p className="text-xs text-fg-faint">Org master switch is off — an org admin must enable GitLab issue creation under Admin → GitLab first.</p>
          )}
          {issuesError && <p className="text-sm text-crit">{issuesError}</p>}
        </div>
      </section>

      {/* ── Section 3 — Add repositories ──────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-fg">Add repositories</h3>
          <p className="text-sm text-fg-muted">Search the repositories the GitLab connection can see.</p>
        </div>

        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories…" className="font-mono" />

        <div className="flex items-center justify-between text-xs text-fg-faint">
          <span className={data?.sync.status === 'syncing' ? 'text-accent' : undefined}>{data ? syncedLabel(data.sync) : ''}</span>
          <Button variant="ghost" onClick={refresh} className="h-auto px-2 py-1 text-xs">Refresh</Button>
        </div>

        {!data ? <Skeleton rows={6} /> : rows.length === 0 ? (
          manualValid && !exactShown ? (
            <div className="flex items-center justify-between gap-2 rounded-card border border-edge bg-surface px-5 py-3">
              <span className="truncate font-mono text-sm text-fg-muted">{q.trim()}</span>
              <Button variant="secondary" disabled={adding === q.trim()} onClick={() => add(q.trim())}>{adding === q.trim() ? 'Adding…' : 'Add by name'}</Button>
            </div>
          ) : (
            <EmptyState title="No matching repositories" body="Type a full namespace/name to add one directly." />
          )
        ) : (
          <>
            <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
              {rows.map((r) => {
                const added = inScope.has(r.repoFullName);
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex-1 truncate font-mono text-sm text-fg">{r.repoFullName}</span>
                    {r.defaultBranch && <span className="font-mono text-xs text-fg-faint">{r.defaultBranch}{r.private ? ' · private' : ''}</span>}
                    <Button variant={added ? 'ghost' : 'secondary'} disabled={added || adding === r.repoFullName} onClick={() => add(r.repoFullName)}>
                      {added ? '✓ Added' : adding === r.repoFullName ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-xs text-fg-faint">
              <span>Showing {rows.length} of {data.total}</span>
              {data.nextCursor && <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
