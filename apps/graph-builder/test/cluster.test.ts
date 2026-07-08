import { describe, it, expect } from 'vitest';
import { clusterGraph } from '../src/cluster.js';
import type { ParsedGraph } from '../src/parse-repo.js';

const g = (nodes: string[], imports: [string, string][]): ParsedGraph => ({
  nodes: nodes.map((tmpId) => ({ tmpId, kind: 'file', name: tmpId })),
  edges: imports.map(([s, d]) => ({ srcTmpId: s, dstTmpId: d, relation: 'imports' })),
});

describe('clusterGraph', () => {
  it('groups import-connected files and isolates unconnected ones', () => {
    const clusters = clusterGraph(g(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c']]));
    expect(clusters).toEqual([['a', 'b', 'c'], ['d']]);
  });
  it('is deterministic regardless of node order', () => {
    const c1 = clusterGraph(g(['x', 'y', 'z'], [['x', 'y'], ['y', 'z']]));
    const c2 = clusterGraph(g(['z', 'y', 'x'], [['z', 'y'], ['y', 'x']]));
    expect(c1).toEqual(c2);
  });
  it('is deterministic regardless of edge order (node order fixed)', () => {
    // Vary ONLY the order of edges while keeping nodes in the same order.
    const nodes = ['x', 'y', 'z'];
    const c1 = clusterGraph(g(nodes, [['x', 'y'], ['y', 'z']]));
    const c2 = clusterGraph(g(nodes, [['y', 'z'], ['x', 'y']]));
    expect(c1).toEqual(c2);
  });
  it('converges a 6-file linear chain into a single cluster', () => {
    // a→b→c→d→e→f requires 5 propagation passes; the old cap of < 5 would fail.
    const clusters = clusterGraph(
      g(['a', 'b', 'c', 'd', 'e', 'f'], [
        ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f'],
      ]),
    );
    expect(clusters).toEqual([['a', 'b', 'c', 'd', 'e', 'f']]);
  });
  it('ignores non-file nodes and contains edges', () => {
    const graph: ParsedGraph = {
      nodes: [
        { tmpId: 'dir:src', kind: 'module', name: 'src' },
        { tmpId: 'file:src/a', kind: 'file', name: 'src/a' },
      ],
      edges: [{ srcTmpId: 'dir:src', dstTmpId: 'file:src/a', relation: 'contains' }],
    };
    expect(clusterGraph(graph)).toEqual([['file:src/a']]);
  });
});
