'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { fetchKgGraph, type KgGraph } from '../../../lib/api';
import { Skeleton } from '../../ui/skeleton';

// Client-only: react-force-graph touches window/canvas. Lazy so it stays out of the
// main bundle and never runs during the Next static-export prerender.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <Skeleton rows={4} />,
}) as unknown as (props: {
  graphData: GraphData;
  nodeLabel?: string;
  nodeColor?: (n: { kind?: string }) => string;
  nodeRelSize?: number;
  linkColor?: () => string;
  onNodeClick?: (n: { id?: string; kind?: string; name?: string; repoFullName?: string | null; digest?: string | null; metadata?: Record<string, unknown> | null }) => void;
}) => ReactElement;

type GraphData = {
  nodes: { id: string; name: string; kind: string; repoFullName?: string | null }[];
  links: { source: string; target: string; relation?: string }[];
};

// ── Canvas color constants ─────────────────────────────────────────────────────
// react-force-graph is a canvas renderer — Tailwind classes are not available.
// These literal hex values mirror globals.css design tokens exactly (sanctioned
// "dynamic value" exception, same as chart coords). Do NOT use arbitrary hex
// elsewhere in this file; use token classes in the DOM sections.
//
// kind          → token           → hex
// component     → --color-accent  → #F6B73C  (honey, the one accent)
// flow          → --color-info    → #4c9aef  (info blue)
// file          → --color-fg-muted → #9a9ba1 (muted text)
// datastore     → --color-warn    → #E8920C  (amber warning)
// external      → --color-ok      → #36C28B  (green ok)
// metric/log/trace → --color-crit → #ef4d56  (red — signals/telemetry)
// link/edge     → --color-edge    → #2a2c31

const COLOR_COMPONENT = '#F6B73C'; // --color-accent
const COLOR_FLOW      = '#4c9aef'; // --color-info
const COLOR_FILE      = '#9a9ba1'; // --color-fg-muted
const COLOR_DATASTORE = '#E8920C'; // --color-warn
const COLOR_EXTERNAL  = '#36C28B'; // --color-ok
const COLOR_SIGNAL    = '#ef4d56'; // --color-crit (metric/log/trace)
const COLOR_LINK      = '#2a2c31'; // --color-edge

// Legend entries for the DOM (uses token classes, not hex)
const LEGEND: { kind: string; label: string; colorClass: string }[] = [
  { kind: 'component', label: 'Component',    colorClass: 'bg-accent'    },
  { kind: 'flow',      label: 'Flow',         colorClass: 'bg-info'      },
  { kind: 'file',      label: 'File',         colorClass: 'bg-fg-muted'  },
  { kind: 'datastore', label: 'Datastore',    colorClass: 'bg-warn'      },
  { kind: 'external',  label: 'External',     colorClass: 'bg-ok'        },
  { kind: 'signal',    label: 'Signal (metric/log/trace)', colorClass: 'bg-crit' },
];

function nodeColor(kind: string | undefined): string {
  switch (kind) {
    case 'component': return COLOR_COMPONENT;
    case 'flow':      return COLOR_FLOW;
    case 'file':      return COLOR_FILE;
    case 'datastore': return COLOR_DATASTORE;
    case 'external':  return COLOR_EXTERNAL;
    case 'metric':
    case 'log':
    case 'trace':     return COLOR_SIGNAL;
    default:          return COLOR_FILE;
  }
}

// ── Side panel node type ───────────────────────────────────────────────────────

type PanelNode = {
  id: string;
  name: string;
  kind: string;
  repoFullName?: string | null;
  digest?: string | null;
  metadata?: Record<string, unknown> | null;
};

// ── buildVisible ──────────────────────────────────────────────────────────────
//
// Pure function — no side effects, exported for unit testing.
//
// Architecture-first model:
//   Initial visible: component + datastore + external nodes.
//   Clicking a component expands it: composes (files) + touches (flows) + emits (signals).
//   Clicking a flow expands it:      implements_flow (files) + emits (signals).
//   showAllFiles: show ALL file nodes regardless of expansion.
//   repoFilter: array of selected repoFullName values; nodes with null repoFullName
//     (shared cross-repo) are always kept; if empty/["all"] → no filter.
//
// Edges among visible nodes: depends_on + composes + touches + implements_flow + emits + imports.

export function buildVisible(
  graph: KgGraph,
  expanded: Set<string>,
  showAllFiles: boolean,
  repoFilter: string[] = [],
): GraphData {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // ── Collect edges by type ──────────────────────────────────────────────────
  // src→{dst[]} maps per relation
  const composes        = new Map<string, string[]>(); // component → file
  const touchedBy       = new Map<string, string[]>(); // component (dst) → [flow (src)]
  const emits           = new Map<string, string[]>(); // component/flow → signal
  const implementsFlow  = new Map<string, string[]>(); // flow → file
  const dependsOn       = new Map<string, string[]>(); // any → datastore/external
  const imports         = new Map<string, string[]>(); // file → file

  function push(map: Map<string, string[]>, src: string, dst: string) {
    const a = map.get(src) ?? [];
    a.push(dst);
    map.set(src, a);
  }

  for (const e of graph.edges) {
    switch (e.relation) {
      case 'composes':       push(composes,       e.src, e.dst); break;
      case 'touches':        push(touchedBy,      e.dst, e.src); break;
      case 'emits':          push(emits,          e.src, e.dst); break;
      case 'implements_flow':push(implementsFlow, e.src, e.dst); break;
      case 'depends_on':     push(dependsOn,      e.src, e.dst); break;
      case 'imports':        push(imports,        e.src, e.dst); break;
    }
  }

  // ── Build visible node set ─────────────────────────────────────────────────
  const visibleIds = new Set<string>();

  // Always-visible: components, datastores, externals
  for (const n of graph.nodes) {
    if (n.kind === 'component' || n.kind === 'datastore' || n.kind === 'external') {
      visibleIds.add(n.id);
    }
  }

  // Expand components
  for (const id of expanded) {
    const n = nodeById.get(id);
    if (!n) continue;
    if (n.kind === 'component') {
      for (const fid of composes.get(id) ?? []) visibleIds.add(fid);
      for (const fid of touchedBy.get(id) ?? []) visibleIds.add(fid);
      for (const sid of emits.get(id) ?? []) visibleIds.add(sid);
    }
    if (n.kind === 'flow') {
      for (const fid of implementsFlow.get(id) ?? []) visibleIds.add(fid);
      for (const sid of emits.get(id) ?? []) visibleIds.add(sid);
    }
  }

  // showAllFiles: add all file nodes
  if (showAllFiles) {
    for (const n of graph.nodes) {
      if (n.kind === 'file') visibleIds.add(n.id);
    }
  }

  // ── Apply repo filter ──────────────────────────────────────────────────────
  // If repoFilter is non-empty and not ["all"], retain only nodes whose
  // repoFullName is null (shared/cross-repo) OR is in the selected set.
  const hasFilter = repoFilter.length > 0 && !(repoFilter.length === 1 && repoFilter[0] === 'all');
  const filterSet = hasFilter ? new Set(repoFilter) : null;

  const filteredIds = new Set<string>();
  for (const id of visibleIds) {
    const n = nodeById.get(id);
    if (!n) continue;
    if (filterSet === null || n.repoFullName === null || filterSet.has(n.repoFullName)) {
      filteredIds.add(id);
    }
  }

  // ── Build node list ────────────────────────────────────────────────────────
  const nodes = [...filteredIds].flatMap((id) => {
    const n = nodeById.get(id);
    if (!n) return [];
    return [{ id: n.id, name: n.name, kind: n.kind, repoFullName: n.repoFullName ?? null }];
  });

  // ── Build link list ────────────────────────────────────────────────────────
  // All edges whose src and dst are both in the filtered visible set
  const INCLUDED_RELATIONS = new Set([
    'composes',
    'touches',
    'implements_flow',
    'depends_on',
    'emits',
    'imports',
  ]);

  const links = graph.edges
    .filter(
      (e) =>
        INCLUDED_RELATIONS.has(e.relation) &&
        filteredIds.has(e.src) &&
        filteredIds.has(e.dst),
    )
    .map((e) => ({ source: e.src, target: e.dst, relation: e.relation }));

  return { nodes, links };
}

// ── Repo filter helpers ────────────────────────────────────────────────────────

function extractRepos(graph: KgGraph): string[] {
  const repos = new Set<string>();
  for (const n of graph.nodes) {
    if (n.repoFullName) repos.add(n.repoFullName);
  }
  return [...repos].sort();
}

// ── Legend component ───────────────────────────────────────────────────────────

function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="kg-legend">
      {LEGEND.map((l) => (
        <span key={l.kind} className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${l.colorClass}`} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

// ── Side panel ─────────────────────────────────────────────────────────────────

function SidePanel({ node, onClose }: { node: PanelNode; onClose: () => void }) {
  const provider = node.metadata?.provider as string | undefined;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-4 text-sm" data-testid="kg-panel">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-fg">{node.name}</span>
        <button className="text-fg-faint hover:text-fg" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>
      <span className="inline-flex self-start rounded-full border border-edge bg-raised px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">
        {node.kind}
      </span>
      {provider && (
        <p className="text-fg-muted">
          <span className="text-fg-faint">Provider: </span>
          {provider}
        </p>
      )}
      {node.repoFullName && (
        <p className="font-mono text-xs text-fg-faint">{node.repoFullName}</p>
      )}
      {node.digest && <p className="text-fg-muted">{node.digest}</p>}
    </div>
  );
}

// ── KgExplore component ────────────────────────────────────────────────────────

// Nodes that can be expanded (clicking toggles expand/collapse)
const EXPANDABLE_KINDS = new Set(['component', 'flow']);

export function KgExplore({ slug }: { slug: string }) {
  const [graph, setGraph]           = useState<KgGraph | null>(null);
  const [error, setError]           = useState('');
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [repoFilter, setRepoFilter] = useState<string[]>([]);
  const [panel, setPanel]           = useState<PanelNode | null>(null);

  useEffect(() => {
    let off = false;
    fetchKgGraph(slug)
      .then((g) => {
        if (!off) setGraph(g);
      })
      .catch((e: { message?: string }) => {
        if (!off) setError(e?.message ?? 'Failed to load graph');
      });
    return () => {
      off = true;
    };
  }, [slug]);

  const repos = useMemo(() => (graph ? extractRepos(graph) : []), [graph]);

  const data = useMemo(
    () => (graph ? buildVisible(graph, expanded, showAllFiles, repoFilter) : { nodes: [], links: [] }),
    [graph, expanded, showAllFiles, repoFilter],
  );

  if (error) return <p className="text-sm text-crit">{error}</p>;
  if (!graph) return <Skeleton rows={4} />;

  function handleNodeClick(n: { id?: string; kind?: string; name?: string; repoFullName?: string | null; digest?: string | null; metadata?: Record<string, unknown> | null }) {
    if (!n.id) return;
    const id = n.id;
    const kind = n.kind ?? '';

    if (EXPANDABLE_KINDS.has(kind)) {
      // Toggle expand/collapse
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setPanel(null);
    } else {
      // Non-expandable: open side panel
      setPanel({ id, name: n.name ?? id, kind, repoFullName: n.repoFullName, digest: n.digest, metadata: n.metadata });
    }
  }

  function toggleRepo(repo: string) {
    setRepoFilter((prev) => {
      if (prev.includes(repo)) return prev.filter((r) => r !== repo);
      return [...prev, repo];
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={showAllFiles} onChange={(e) => setShowAllFiles(e.target.checked)} />
          Show all files
        </label>

        {repos.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <span className="text-fg-faint">Repos:</span>
            {repos.map((repo) => (
              <label key={repo} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={repoFilter.includes(repo)}
                  onChange={() => toggleRepo(repo)}
                />
                <span className="font-mono text-xs">{repo}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <GraphLegend />

      {/* Graph canvas */}
      <div className="h-[480px] overflow-hidden rounded-card border border-edge bg-canvas" data-testid="kg-graph">
        <ForceGraph2D
          graphData={data}
          nodeLabel="name"
          nodeColor={(n) => nodeColor(n.kind)}
          nodeRelSize={6}
          linkColor={() => COLOR_LINK}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* Side panel for non-expandable node details */}
      {panel && <SidePanel node={panel} onClose={() => setPanel(null)} />}

      <p className="text-xs text-fg-faint">
        Click a component or flow to expand/collapse. Click a file, datastore, external, or signal for details.
        Drag to pan, scroll to zoom.
      </p>
    </div>
  );
}
