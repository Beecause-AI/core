import { describe, it, expect } from 'vitest';
import { parseRepo } from '../src/parse-repo.js';

function reader(files: Record<string, string>) {
  return {
    commitSha: 'c', truncated: false,
    files: Object.keys(files).sort().map((p) => ({ path: p, sha: 's' })),
    read: async (p: string) => files[p] ?? null,
  };
}

describe('parseRepo Pass A', () => {
  it('emits file nodes, dir contains hierarchy, and intra-repo import edges', async () => {
    const r = reader({
      'src/checkout.ts': "import { pay } from './pay';\nimport x from 'lib';",
      'src/pay.ts': 'export const pay = () => {};',
    });
    const g = await parseRepo(r as any, 'acme/web');
    const names = g.nodes.map((n) => n.name);
    expect(names).toContain('src/checkout.ts');
    expect(names).toContain('src/pay.ts');
    expect(g.nodes.some((n) => n.kind === 'module' && n.name === 'src')).toBe(true);

    const id = (p: string) => g.nodes.find((n) => n.name === p)!.tmpId;
    // intra-repo relative import → edge between the two file nodes
    expect(g.edges).toContainEqual({ srcTmpId: id('src/checkout.ts'), dstTmpId: id('src/pay.ts'), relation: 'imports' });
    // dir 'src' contains the two files
    expect(g.edges).toContainEqual({ srcTmpId: id('src'), dstTmpId: id('src/checkout.ts'), relation: 'contains' });
    // external 'lib' import → no edge
    expect(g.edges.filter((e) => e.relation === 'imports').length).toBe(1);
  });

  it('is deterministic (same files → same node/edge counts)', async () => {
    const files = { 'a/x.py': 'from a.y import z', 'a/y.py': 'z = 1' };
    const g1 = await parseRepo(reader(files) as any, 'r');
    const g2 = await parseRepo(reader(files) as any, 'r');
    expect(g1.nodes.length).toBe(g2.nodes.length);
    expect(g1.edges.length).toBe(g2.edges.length);
  });

  it('degrades: unreadable file still yields a node, unknown imports ignored', async () => {
    const r = { commitSha: 'c', truncated: false, files: [{ path: 'main.go', sha: 's' }], read: async () => null };
    const g = await parseRepo(r as any, 'r');
    expect(g.nodes.find((n) => n.name === 'main.go')).toBeTruthy();
    expect(g.edges.filter((e) => e.relation === 'imports').length).toBe(0);
  });
});
