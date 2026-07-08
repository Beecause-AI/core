'use client';

import { useMemo, useState } from 'react';
import type { GroupProvider, ModelGroup } from '../../lib/api';
import { Input } from '../ui/input';

export type ModelValue = { model: string; provider: GroupProvider };

type Row = {
  model: string;
  provider: GroupProvider;
  displayName: string;
  input: number | null;
  output: number | null;
};

type SortKey = 'input' | 'output';
type SortDir = 'asc' | 'desc';

const price = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

export function ModelPicker({
  groups, value, onChange,
}: {
  groups: ModelGroup[];
  value: ModelValue | null;
  onChange: (v: ModelValue) => void;
}) {
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('input');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const all = groups.flatMap((g) =>
      g.models.map((m) => ({
        model: m.id,
        provider: g.provider,
        displayName: m.displayName,
        input: m.pricing?.inputPer1M ?? null,
        output: m.pricing?.outputPer1M ?? null,
      })),
    );
    const matched = needle ? all.filter((r) => r.displayName.toLowerCase().includes(needle)) : all;
    // Price sort; rows without a price always sink to the bottom.
    const dir = sortDir === 'asc' ? 1 : -1;
    return matched.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return a.displayName.localeCompare(b.displayName);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir || a.displayName.localeCompare(b.displayName);
    });
  }, [groups, q, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '');

  return (
    <div className="flex flex-col gap-3">
      <Input placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="overflow-hidden rounded-card border border-edge">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge bg-surface text-xs uppercase tracking-wide text-fg-faint">
              <th className="px-4 py-2.5 text-left font-medium">Model</th>
              <SortTh label="Input · 1M" active={sortKey === 'input'} arrow={arrow('input')} onClick={() => toggleSort('input')} />
              <SortTh label="Output · 1M" active={sortKey === 'output'} arrow={arrow('output')} onClick={() => toggleSort('output')} />
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {rows.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-fg-faint">No models match “{q}”.</td></tr>
            ) : rows.map((r) => {
              const selected = value?.model === r.model && value?.provider === r.provider;
              return (
                <tr
                  key={`${r.provider}:${r.model}`}
                  onClick={() => onChange({ model: r.model, provider: r.provider })}
                  aria-selected={selected}
                  className={`cursor-pointer transition-colors ${selected ? 'bg-accent/10' : 'hover:bg-raised'}`}
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className={`size-1.5 shrink-0 rounded-full ${selected ? 'bg-accent' : 'bg-transparent'}`} />
                      <span className={`font-medium ${selected ? 'text-fg' : 'text-fg'}`}>{r.displayName}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-fg-muted tabular-nums">{price(r.input)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-fg-muted tabular-nums">{price(r.output)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortTh({ label, active, arrow, onClick }: { label: string; active: boolean; arrow: string; onClick: () => void }) {
  return (
    <th className="px-4 py-2.5 text-right font-medium">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-fg ${active ? 'text-fg' : 'text-fg-faint'}`}
      >
        {label}<span className="w-2 text-accent">{arrow}</span>
      </button>
    </th>
  );
}
