// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildVisible, KgExplore } from '../src/components/project/knowledge-graph/kg-explore';
import type { KgGraph } from '../src/lib/api';

// The force-graph canvas lib is heavy and touches window — stub it to a plain div
// that reports how many nodes it received, so the render test stays light.
vi.mock('react-force-graph-2d', () => ({
  default: ({ graphData }: { graphData: { nodes: unknown[] } }) => (
    <div data-testid="fg">nodes:{graphData.nodes.length}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubGraph(graph: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(graph), { status: 200 })));
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const fixture: KgGraph = {
  nodes: [
    { id: 'comp1', kind: 'component', name: 'API',         businessFlow: null, digest: null, metadata: null, repoFullName: 'acme/api' },
    { id: 'comp2', kind: 'component', name: 'Worker',      businessFlow: null, digest: null, metadata: null, repoFullName: 'acme/worker' },
    { id: 'flow1', kind: 'flow',      name: 'Checkout',    businessFlow: 'Checkout', digest: null, metadata: null, repoFullName: 'acme/api' },
    { id: 'flow2', kind: 'flow',      name: 'Notify',      businessFlow: 'Notify',   digest: null, metadata: null, repoFullName: 'acme/worker' },
    { id: 'f1',   kind: 'file',      name: 'src/a.ts',    businessFlow: null, digest: null, metadata: null, repoFullName: 'acme/api' },
    { id: 'f2',   kind: 'file',      name: 'src/b.ts',    businessFlow: null, digest: null, metadata: null, repoFullName: 'acme/worker' },
    { id: 'ds1',  kind: 'datastore', name: 'Postgres',     businessFlow: null, digest: null, metadata: null, repoFullName: null },
    { id: 'ext1', kind: 'external',  name: 'Stripe',       businessFlow: null, digest: null, metadata: null, repoFullName: null },
    { id: 'sig1', kind: 'metric',    name: 'checkout_total', businessFlow: null, digest: null, metadata: null, repoFullName: 'acme/api' },
  ],
  edges: [
    { src: 'flow1', dst: 'comp1',  relation: 'touches'         },
    { src: 'comp1', dst: 'f1',     relation: 'composes'        },
    { src: 'comp1', dst: 'sig1',   relation: 'emits'           },
    { src: 'comp1', dst: 'ds1',    relation: 'depends_on'      },
    { src: 'flow1', dst: 'f1',     relation: 'implements_flow' },
    { src: 'flow1', dst: 'sig1',   relation: 'emits'           },
    { src: 'flow2', dst: 'comp2',  relation: 'touches'         },
    { src: 'comp2', dst: 'f2',     relation: 'composes'        },
    { src: 'flow2', dst: 'f2',     relation: 'implements_flow' },
    { src: 'f1',   dst: 'f2',     relation: 'imports'         },
    { src: 'comp2', dst: 'ext1',   relation: 'depends_on'      },
  ],
};

// ── buildVisible unit tests ───────────────────────────────────────────────────

describe('buildVisible', () => {
  test('initial: components + datastores + externals visible; files/flows/signals hidden', () => {
    const { nodes } = buildVisible(fixture, new Set(), false);
    const ids = new Set(nodes.map((n) => n.id));
    // present
    expect(ids.has('comp1')).toBe(true);
    expect(ids.has('comp2')).toBe(true);
    expect(ids.has('ds1')).toBe(true);
    expect(ids.has('ext1')).toBe(true);
    // absent
    expect(ids.has('flow1')).toBe(false);
    expect(ids.has('flow2')).toBe(false);
    expect(ids.has('f1')).toBe(false);
    expect(ids.has('f2')).toBe(false);
    expect(ids.has('sig1')).toBe(false);
  });

  test('initial depends_on edge between comp1 and ds1 is present', () => {
    const { links } = buildVisible(fixture, new Set(), false);
    expect(links).toContainEqual(expect.objectContaining({ source: 'comp1', target: 'ds1' }));
  });

  test('expand component → composes files + touches flows + emits signals appear', () => {
    const { nodes, links } = buildVisible(fixture, new Set(['comp1']), false);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has('f1')).toBe(true);    // composes
    expect(ids.has('flow1')).toBe(true); // touches
    expect(ids.has('sig1')).toBe(true);  // emits
    // edges to newly visible nodes
    expect(links).toContainEqual(expect.objectContaining({ source: 'comp1', target: 'f1' }));
    expect(links).toContainEqual(expect.objectContaining({ source: 'flow1', target: 'comp1' }));
    expect(links).toContainEqual(expect.objectContaining({ source: 'comp1', target: 'sig1' }));
    // depends_on datastore edge still present
    expect(links).toContainEqual(expect.objectContaining({ source: 'comp1', target: 'ds1' }));
    // comp2-only nodes absent
    expect(ids.has('f2')).toBe(false);
    expect(ids.has('flow2')).toBe(false);
  });

  test('expand a flow → implements_flow files + emits signals appear', () => {
    // Need to also expand comp1 so flow1 is visible first, then expand flow1
    const { nodes, links } = buildVisible(fixture, new Set(['comp1', 'flow1']), false);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has('f1')).toBe(true);    // implements_flow + composes
    expect(ids.has('sig1')).toBe(true);  // emits from flow1
    expect(links).toContainEqual(expect.objectContaining({ source: 'flow1', target: 'f1' }));
    expect(links).toContainEqual(expect.objectContaining({ source: 'flow1', target: 'sig1' }));
  });

  test('expand flow directly (without component) → implements_flow files visible', () => {
    const { nodes } = buildVisible(fixture, new Set(['flow1']), false);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has('f1')).toBe(true);
  });

  test('showAllFiles → all file nodes visible regardless of expansion', () => {
    const { nodes } = buildVisible(fixture, new Set(), true);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has('f1')).toBe(true);
    expect(ids.has('f2')).toBe(true);
    // components + datastores + externals still present
    expect(ids.has('comp1')).toBe(true);
    expect(ids.has('ds1')).toBe(true);
    // imports edge visible when both files are shown
    const { links } = buildVisible(fixture, new Set(), true);
    expect(links).toContainEqual(expect.objectContaining({ source: 'f1', target: 'f2' }));
  });

  test('repo filter: selecting repo A hides repo-B-only nodes; null-repo nodes kept', () => {
    const { nodes } = buildVisible(fixture, new Set(), false, ['acme/api']);
    const ids = new Set(nodes.map((n) => n.id));
    // acme/api nodes
    expect(ids.has('comp1')).toBe(true);
    // null-repo shared nodes always kept
    expect(ids.has('ds1')).toBe(true);
    expect(ids.has('ext1')).toBe(true);
    // acme/worker-only component hidden
    expect(ids.has('comp2')).toBe(false);
  });

  test('repo filter: all repos selected (empty filter) shows everything visible', () => {
    const { nodes } = buildVisible(fixture, new Set(), false, []);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has('comp1')).toBe(true);
    expect(ids.has('comp2')).toBe(true);
    expect(ids.has('ds1')).toBe(true);
    expect(ids.has('ext1')).toBe(true);
  });

  test('repo filter with expand: filtered-out expanded child not shown', () => {
    // Expand comp2 but filter to acme/api — comp2's children (f2, flow2) and comp2 itself hidden
    const { nodes } = buildVisible(fixture, new Set(['comp2']), false, ['acme/api']);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has('comp2')).toBe(false);
    expect(ids.has('f2')).toBe(false);
    expect(ids.has('flow2')).toBe(false);
    // Shared deps still present
    expect(ids.has('ds1')).toBe(true);
    expect(ids.has('ext1')).toBe(true);
  });
});

// ── KgExplore render tests ────────────────────────────────────────────────────

describe('KgExplore', () => {
  test('renders initial architecture nodes (components + datastores + externals) via force graph', async () => {
    stubGraph(fixture);
    render(<KgExplore slug="acme" />);
    // Initial: comp1 + comp2 + ds1 + ext1 = 4 nodes
    await waitFor(() => expect(screen.getByTestId('fg').textContent).toBe('nodes:4'));
  });

  test('renders the legend', async () => {
    stubGraph(fixture);
    render(<KgExplore slug="acme" />);
    await waitFor(() => expect(screen.getByTestId('kg-legend')).toBeTruthy());
  });

  test('renders the graph container', async () => {
    stubGraph(fixture);
    render(<KgExplore slug="acme" />);
    await waitFor(() => expect(screen.getByTestId('kg-graph')).toBeTruthy());
  });
});
