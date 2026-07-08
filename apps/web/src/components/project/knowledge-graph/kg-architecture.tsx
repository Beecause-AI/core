'use client';

import { useEffect, useState } from 'react';
import { fetchKgGraph, fetchKgChildren, type KgGraph, type KgGraphNode } from '../../../lib/api';
import { Skeleton } from '../../ui/skeleton';
import { Card } from '../../ui/card';

// ── Breadcrumb ────────────────────────────────────────────────────────────────

type StackEntry = { node: KgGraphNode; label: string };

function Breadcrumb({
  stack,
  onJump,
}: {
  stack: StackEntry[];
  onJump: (index: number) => void;
}) {
  const crumbs = [{ label: 'Architecture', index: -1 }, ...stack.map((e, i) => ({ label: e.label, index: i }))];
  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      {crumbs.map((c, pos) => {
        const last = pos === crumbs.length - 1;
        return (
          <span key={pos} className="flex items-center gap-2">
            {last ? (
              <span className="font-medium text-fg">{c.label}</span>
            ) : (
              <button
                className="text-fg-muted transition-colors hover:text-fg"
                onClick={() => onJump(c.index)}
              >
                {c.label}
              </button>
            )}
            {!last && <span className="text-fg-faint">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

// ── Kind chip ─────────────────────────────────────────────────────────────────

function KindChip({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-edge bg-raised px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">
      {kind}
    </span>
  );
}

// ── Repo badge ────────────────────────────────────────────────────────────────

function RepoBadge({ repo }: { repo: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-edge bg-raised px-2 py-0.5 font-mono text-xs text-fg-faint">
      {repo}
    </span>
  );
}

// ── Node card (clickable) ──────────────────────────────────────────────────────

function NodeCard({ node, onClick }: { node: KgGraphNode; onClick?: (n: KgGraphNode) => void }) {
  const clickable = onClick != null;
  return (
    <Card
      className={clickable ? 'cursor-pointer hover:border-edge-strong' : undefined}
      onClick={clickable ? () => onClick(node) : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-base font-medium text-fg">{node.name}</span>
        <KindChip kind={node.kind} />
      </div>
      {node.digest && <p className="text-sm text-fg-muted">{node.digest}</p>}
      {node.repoFullName && (
        <div className="mt-1 flex flex-wrap gap-1">
          <RepoBadge repo={node.repoFullName} />
        </div>
      )}
    </Card>
  );
}

// ── Section grouping ──────────────────────────────────────────────────────────

function NodeSection({
  title,
  nodes,
  onDrill,
}: {
  title: string;
  nodes: KgGraphNode[];
  onDrill?: (n: KgGraphNode) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-fg-faint">{title}</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((n) => (
          <NodeCard key={n.id} node={n} onClick={onDrill} />
        ))}
      </div>
    </div>
  );
}

// ── Architecture root level ───────────────────────────────────────────────────

function ArchitectureRoot({
  graph,
  onDrillComponent,
}: {
  graph: KgGraph;
  onDrillComponent: (n: KgGraphNode) => void;
}) {
  const components = graph.nodes.filter((n) => n.kind === 'component');
  const datastores = graph.nodes.filter((n) => n.kind === 'datastore');
  const externals = graph.nodes.filter((n) => n.kind === 'external');
  const signals = graph.nodes.filter((n) => n.kind === 'metric' || n.kind === 'log' || n.kind === 'trace');

  if (components.length === 0 && datastores.length === 0 && externals.length === 0 && signals.length === 0) {
    return (
      <p className="text-sm text-fg-faint">No architecture nodes found. Rebuild the knowledge graph to generate them.</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <NodeSection title="Components" nodes={components} onDrill={onDrillComponent} />
      <NodeSection title="Datastores" nodes={datastores} />
      <NodeSection title="External" nodes={externals} />
      <NodeSection title="Signals" nodes={signals} />
    </div>
  );
}

// ── Component level ───────────────────────────────────────────────────────────

function ComponentLevel({
  children,
  onDrillFlow,
}: {
  children: KgGraphNode[];
  onDrillFlow: (n: KgGraphNode) => void;
}) {
  const files = children.filter((n) => n.kind === 'file');
  const flows = children.filter((n) => n.kind === 'flow');
  const deps = children.filter((n) => n.kind === 'datastore' || n.kind === 'external');
  const signals = children.filter((n) => n.kind === 'metric' || n.kind === 'log' || n.kind === 'trace');

  if (children.length === 0) {
    return <p className="text-sm text-fg-faint">No children found for this component.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <NodeSection title="Flows" nodes={flows} onDrill={onDrillFlow} />
      <NodeSection title="Files" nodes={files} />
      <NodeSection title="Dependencies" nodes={deps} />
      <NodeSection title="Signals" nodes={signals} />
    </div>
  );
}

// ── Flow level ────────────────────────────────────────────────────────────────

function FlowLevel({
  children,
  onDrillFile,
}: {
  children: KgGraphNode[];
  onDrillFile: (n: KgGraphNode) => void;
}) {
  const files = children.filter((n) => n.kind === 'file');
  const components = children.filter((n) => n.kind === 'component');
  const deps = children.filter((n) => n.kind === 'datastore' || n.kind === 'external');
  const signals = children.filter((n) => n.kind === 'metric' || n.kind === 'log' || n.kind === 'trace');

  if (children.length === 0) {
    return <p className="text-sm text-fg-faint">No children found for this flow.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <NodeSection title="Files" nodes={files} onDrill={onDrillFile} />
      <NodeSection title="Components" nodes={components} />
      <NodeSection title="Dependencies" nodes={deps} />
      <NodeSection title="Signals" nodes={signals} />
    </div>
  );
}

// ── File level ────────────────────────────────────────────────────────────────

function FileDetail({ node }: { node: KgGraphNode }) {
  const path = node.metadata?.path as string | undefined;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="text-base font-medium text-fg">{node.name}</span>
          <KindChip kind={node.kind} />
        </div>
        {path && (
          <span className="font-mono text-sm text-fg-faint">{path}</span>
        )}
        {node.digest && <p className="text-sm text-fg-muted">{node.digest}</p>}
        {node.repoFullName && (
          <div className="mt-1 flex flex-wrap gap-1">
            <RepoBadge repo={node.repoFullName} />
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Drill level state ─────────────────────────────────────────────────────────

type DrillLevel =
  | { kind: 'root' }
  | { kind: 'component'; node: KgGraphNode; children: KgGraphNode[] | null; error: string }
  | { kind: 'flow'; node: KgGraphNode; children: KgGraphNode[] | null; error: string }
  | { kind: 'file'; node: KgGraphNode };

// ── Main export ───────────────────────────────────────────────────────────────

export function KgArchitecture({ slug }: { slug: string }) {
  const [graph, setGraph] = useState<KgGraph | null>(null);
  const [graphError, setGraphError] = useState('');
  // Stack tracks the drill path: each entry is the current level node
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [level, setLevel] = useState<DrillLevel>({ kind: 'root' });

  // Load root graph
  useEffect(() => {
    let off = false;
    fetchKgGraph(slug)
      .then((g) => { if (!off) setGraph(g); })
      .catch((e: { message?: string }) => { if (!off) setGraphError(e?.message ?? 'Failed to load architecture'); });
    return () => { off = true; };
  }, [slug]);

  // Drill into a node — fetch its children
  function drillInto(node: KgGraphNode, rels: string[], nextKind: 'component' | 'flow' | 'file') {
    if (nextKind === 'file') {
      setStack((prev) => [...prev, { node, label: node.name }]);
      setLevel({ kind: 'file', node });
      return;
    }
    // Optimistically push the level in loading state
    const newEntry: StackEntry = { node, label: node.name };
    setStack((prev) => [...prev, newEntry]);
    setLevel({ kind: nextKind, node, children: null, error: '' } as DrillLevel);

    let off = false;
    // For components, flows come via INCOMING touches (flow→component direction).
    // Fetch outgoing rels (minus touches) + incoming touches separately, then merge.
    const outgoingRels = nextKind === 'component'
      ? rels.filter((r) => r !== 'touches')
      : rels;
    const fetches: Promise<KgGraphNode[]>[] = [fetchKgChildren(slug, node.id, outgoingRels)];
    if (nextKind === 'component') {
      fetches.push(fetchKgChildren(slug, node.id, ['touches'], 'in'));
    }
    Promise.all(fetches)
      .then(([outgoing, incomingTouches]) => {
        if (off) return;
        const children = [...(outgoing ?? []), ...(incomingTouches ?? [])];
        setLevel({ kind: nextKind, node, children, error: '' } as DrillLevel);
      })
      .catch((e: { message?: string }) => {
        if (off) return;
        setLevel({ kind: nextKind, node, children: [], error: e?.message ?? 'Failed to load children' } as DrillLevel);
      });
    return () => { off = true; };
  }

  // Jump to a specific crumb index (-1 = root, 0..n = stack[index])
  function handleJump(index: number) {
    if (index === -1) {
      setStack([]);
      setLevel({ kind: 'root' });
      return;
    }
    const newStack = stack.slice(0, index + 1);
    setStack(newStack);
    const entry = newStack[index];
    if (!entry) return;
    // Re-drill into the entry node at the correct level
    const depth = index; // 0 = component, 1 = flow, 2 = file
    if (depth === 0) {
      drillInto(entry.node, ['composes', 'touches', 'depends_on', 'emits'], 'component');
      // Remove the last added entry since drillInto pushes again — restore correct stack
      setStack(newStack);
    } else if (depth === 1) {
      drillInto(entry.node, ['implements_flow', 'touches', 'depends_on', 'emits'], 'flow');
      setStack(newStack);
    }
  }

  // ── Loading / error for root graph ──────────────────────────────────────────
  if (graphError) return <p className="text-sm text-crit">{graphError}</p>;
  if (!graph) return <Skeleton rows={4} variant="grid" />;

  // ── Render level ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb stack={stack} onJump={handleJump} />

      {level.kind === 'root' && (
        <ArchitectureRoot
          graph={graph}
          onDrillComponent={(n) => drillInto(n, ['composes', 'touches', 'depends_on', 'emits'], 'component')}
        />
      )}

      {level.kind === 'component' && (
        level.children === null ? (
          level.error ? <p className="text-sm text-crit">{level.error}</p> : <Skeleton rows={3} variant="grid" />
        ) : level.error ? (
          <p className="text-sm text-crit">{level.error}</p>
        ) : (
          <ComponentLevel
            children={level.children}
            onDrillFlow={(n) => drillInto(n, ['implements_flow', 'touches', 'depends_on', 'emits'], 'flow')}
          />
        )
      )}

      {level.kind === 'flow' && (
        level.children === null ? (
          level.error ? <p className="text-sm text-crit">{level.error}</p> : <Skeleton rows={3} variant="grid" />
        ) : level.error ? (
          <p className="text-sm text-crit">{level.error}</p>
        ) : (
          <FlowLevel
            children={level.children}
            onDrillFile={(n) => drillInto(n, [], 'file')}
          />
        )
      )}

      {level.kind === 'file' && <FileDetail node={level.node} />}
    </div>
  );
}
