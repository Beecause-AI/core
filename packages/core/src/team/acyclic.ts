/** Remove self-edges and back-edges so the delegation graph is a DAG. Deterministic:
 *  iterate nodes in array order, DFS, and drop any edge that points to a node currently
 *  on the recursion stack (a back-edge / cycle) or to itself. Unknown targets are kept
 *  (they're filtered elsewhere) — operate only on the given node set. */
export function breakDelegationCycles<T extends { key: string; delegatesTo: string[] }>(nodes: T[]): T[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // Pruned edge sets, keyed by node key. Seeded from the originals so the DFS sees
  // earlier prunes (a dropped back-edge isn't traversed again).
  const kept = new Map<string, string[]>(nodes.map((n) => [n.key, [...n.delegatesTo]]));

  // white = unvisited, gray = on recursion stack, black = fully explored.
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.key, 'white']));

  const visit = (key: string): void => {
    color.set(key, 'gray');
    const edges = kept.get(key)!;
    const next: string[] = [];
    for (const target of edges) {
      if (target === key) continue; // self-edge → drop
      const targetNode = byKey.get(target);
      if (!targetNode) { next.push(target); continue; } // unknown target → keep, don't traverse
      if (color.get(target) === 'gray') continue; // back-edge (cycle) → drop
      next.push(target);
      if (color.get(target) === 'white') visit(target);
    }
    kept.set(key, next);
    color.set(key, 'black');
  };

  for (const n of nodes) {
    if (color.get(n.key) === 'white') visit(n.key);
  }

  return nodes.map((n) => ({ ...n, delegatesTo: kept.get(n.key)! }));
}
