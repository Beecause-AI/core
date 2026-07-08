'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchKnowledgeGraph, triggerKgBuild, type KgBuildStatus, type KgFlow, type ProjectRepo } from '../../../lib/api';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../ui/button';
import { KgGate } from './kg-gate';
import { KgEmptyHero } from './kg-empty-hero';
import { KgBuilding } from './kg-building';
import { KgArchitecture } from './kg-architecture';
import { KgExplore } from './kg-explore';

type KgData = { build: KgBuildStatus | null; flows: KgFlow[] };

export function KnowledgeGraphSection({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  // null = loading; 'gate' = no repos; otherwise project KG data
  const [repoCount, setRepoCount] = useState<number | null>(null);
  const [data, setData] = useState<KgData | null>(null);
  const [view, setView] = useState<'architecture' | 'explore'>('architecture');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const offRef = useRef(false);
  useEffect(() => () => { offRef.current = true; }, []);

  // Load project repos count (gate check) + KG status in parallel.
  const load = useCallback(async () => {
    try {
      const [kg, repos] = await Promise.all([
        fetchKnowledgeGraph(slug),
        api<ProjectRepo[]>(`/api/org/projects/${slug}/repos`),
      ]);
      if (offRef.current) return;
      setRepoCount(repos.length);
      setData(kg);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 401 || offRef.current) return;
      setError(err?.message ?? 'Failed to load knowledge graph');
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const running = data?.build?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(t);
  }, [running, load]);

  const build = useCallback(async () => {
    setBusy(true);
    try {
      await triggerKgBuild(slug);
      // Optimistically show running state while the server updates.
      setData((prev) => ({
        build: { status: 'running', phase: 'structure', nodesAnalyzed: prev?.build?.nodesAnalyzed ?? 0, tokens: 0, note: null, finishedAt: null },
        flows: prev?.flows ?? [],
      }));
    } catch (e) {
      const err = e as { message?: string };
      if (!offRef.current) setError(err?.message ?? 'Failed to start build');
    } finally {
      if (!offRef.current) { setBusy(false); void load(); }
    }
  }, [slug, load]);

  // Loading state
  if (repoCount === null || data === null) return <Skeleton rows={4} />;

  // Gate: no repos connected
  if (repoCount === 0) return <KgGate slug={slug} />;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold tracking-tight text-fg">Knowledge Graph</h2>

      {error && <p className="text-sm text-crit">{error}</p>}

      {data.build === null ? (
        isAdmin
          ? <KgEmptyHero onBuild={() => void build()} building={busy} />
          : <p className="text-sm text-fg-faint">No knowledge graph yet. An admin can build it.</p>
      ) : data.build.status === 'running' ? (
        <KgBuilding phase={data.build.phase} />
      ) : data.build.status === 'error' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-crit">{data.build.note ?? 'Build failed.'}</p>
          {isAdmin && <KgEmptyHero onBuild={() => void build()} building={busy} />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Note banner + Rebuild affordance */}
          {data.build.note && (
            <p className="rounded-md border border-edge bg-raised px-3 py-2 text-sm text-fg-muted">
              {data.build.note}
            </p>
          )}
          {/* View toggle */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-md border border-edge bg-raised p-1">
              <button
                className={`rounded px-3 py-1 text-sm font-medium transition-colors ${view === 'architecture' ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'}`}
                onClick={() => setView('architecture')}
              >
                Architecture
              </button>
              <button
                className={`rounded px-3 py-1 text-sm font-medium transition-colors ${view === 'explore' ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'}`}
                onClick={() => setView('explore')}
                data-testid="explore-toggle"
              >
                Explore graph
              </button>
            </div>
            {isAdmin && (
              <Button variant="ghost" disabled={busy} onClick={() => void build()}>
                {busy ? 'Starting…' : 'Rebuild'}
              </Button>
            )}
          </div>
          {view === 'architecture' ? (
            <KgArchitecture slug={slug} />
          ) : (
            <KgExplore slug={slug} />
          )}
        </div>
      )}
    </div>
  );
}
