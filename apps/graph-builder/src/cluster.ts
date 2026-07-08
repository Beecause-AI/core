import type { ParsedGraph } from './parse-repo.js';

export type Cluster = string[]; // sorted file tmpIds

/** Deterministic community detection via synchronous label propagation over the
 *  undirected projection of `imports` edges between `file` nodes. Same graph →
 *  same clusters, independent of input ordering. Files with no import neighbours
 *  form singleton clusters. Non-file nodes and non-import edges are ignored.
 *  Iterates at most `files.length` times (safe upper bound for convergence);
 *  the early-exit `if (!changed) break` keeps it fast in practice. */
export function clusterGraph(graph: ParsedGraph): Cluster[] {
  const files = graph.nodes.filter((n) => n.kind === 'file').map((n) => n.tmpId).sort();
  const fileSet = new Set(files);
  const adj = new Map<string, Set<string>>(files.map((f) => [f, new Set<string>()]));
  for (const e of graph.edges) {
    if (e.relation !== 'imports') continue;
    if (!fileSet.has(e.srcTmpId) || !fileSet.has(e.dstTmpId)) continue;
    adj.get(e.srcTmpId)!.add(e.dstTmpId);
    adj.get(e.dstTmpId)!.add(e.srcTmpId);
  }

  const label = new Map<string, string>(files.map((f) => [f, f]));
  for (let iter = 0; iter < files.length; iter++) {
    let changed = false;
    for (const f of files) {
      let best = label.get(f)!;
      for (const nb of adj.get(f)!) {
        const l = label.get(nb)!;
        if (l < best) best = l;
      }
      if (best !== label.get(f)) {
        label.set(f, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLabel = new Map<string, string[]>();
  for (const f of files) {
    const l = label.get(f)!;
    if (!byLabel.has(l)) byLabel.set(l, []);
    byLabel.get(l)!.push(f);
  }
  return [...byLabel.values()]
    .map((c) => c.sort())
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}
