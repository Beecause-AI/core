import { describe, it, expect } from 'vitest';
import { breakDelegationCycles } from './acyclic.js';

type Node = { key: string; delegatesTo: string[] };

/** Returns true if the keyed delegatesTo graph contains a cycle (self-edges count). */
function hasCycle(nodes: Node[]): boolean {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.key, 'white']));
  let cycle = false;
  const visit = (key: string) => {
    color.set(key, 'gray');
    for (const t of byKey.get(key)!.delegatesTo) {
      const tn = byKey.get(t);
      if (!tn) continue;
      if (color.get(t) === 'gray') { cycle = true; return; }
      if (color.get(t) === 'white') visit(t);
    }
    color.set(key, 'black');
  };
  for (const n of nodes) if (color.get(n.key) === 'white') visit(n.key);
  return cycle;
}

describe('breakDelegationCycles', () => {
  it('breaks a 2-cycle by dropping exactly the back-edge, keeping it connected A→B', () => {
    const out = breakDelegationCycles([
      { key: 'A', delegatesTo: ['B'] },
      { key: 'B', delegatesTo: ['A'] },
    ]);
    const a = out.find((n) => n.key === 'A')!;
    const b = out.find((n) => n.key === 'B')!;
    expect(a.delegatesTo).toEqual(['B']); // forward edge kept
    expect(b.delegatesTo).toEqual([]); // back-edge dropped
    expect(hasCycle(out)).toBe(false);
  });

  it('removes a self-edge', () => {
    const out = breakDelegationCycles([{ key: 'A', delegatesTo: ['A'] }]);
    expect(out[0]!.delegatesTo).toEqual([]);
    expect(hasCycle(out)).toBe(false);
  });

  it('breaks a 3-cycle A→B→C→A', () => {
    const out = breakDelegationCycles([
      { key: 'A', delegatesTo: ['B'] },
      { key: 'B', delegatesTo: ['C'] },
      { key: 'C', delegatesTo: ['A'] },
    ]);
    expect(hasCycle(out)).toBe(false);
    // forward chain preserved, only the closing back-edge removed
    expect(out.find((n) => n.key === 'A')!.delegatesTo).toEqual(['B']);
    expect(out.find((n) => n.key === 'B')!.delegatesTo).toEqual(['C']);
    expect(out.find((n) => n.key === 'C')!.delegatesTo).toEqual([]);
  });

  it('leaves an already-acyclic graph unchanged', () => {
    const input: Node[] = [
      { key: 'orch', delegatesTo: ['a', 'b'] },
      { key: 'a', delegatesTo: ['c'] },
      { key: 'b', delegatesTo: [] },
      { key: 'c', delegatesTo: [] },
    ];
    const out = breakDelegationCycles(input);
    expect(out).toEqual(input);
    expect(hasCycle(out)).toBe(false);
  });

  it('keeps unknown targets (filtered elsewhere) and preserves other fields', () => {
    const out = breakDelegationCycles([
      { key: 'A', delegatesTo: ['ghost', 'B'], name: 'Alpha' } as Node & { name: string },
      { key: 'B', delegatesTo: ['A'] },
    ]);
    const a = out.find((n) => n.key === 'A')! as Node & { name: string };
    expect(a.delegatesTo).toContain('ghost'); // unknown kept
    expect(a.delegatesTo).toContain('B');
    expect(a.name).toBe('Alpha'); // other fields preserved
    expect(hasCycle(out)).toBe(false);
  });

  it('breaks a dense cyclic graph (orchestrator + mutually-delegating peers)', () => {
    const out = breakDelegationCycles([
      { key: 'orch', delegatesTo: ['s1', 's2', 's3'] },
      { key: 's1', delegatesTo: ['s2', 'orch'] },
      { key: 's2', delegatesTo: ['s1', 's3'] },
      { key: 's3', delegatesTo: ['s2', 'orch'] },
    ]);
    expect(hasCycle(out)).toBe(false);
  });
});
