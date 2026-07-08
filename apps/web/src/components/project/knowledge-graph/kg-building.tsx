import { useEffect, useState } from 'react';

// The 5 canonical build phases returned by the server (in order).
const PHASES: { key: string; label: string }[] = [
  { key: 'structure', label: 'Reading repository structure' },
  { key: 'architecture', label: 'Analyzing architecture' },
  { key: 'flows', label: 'Naming business flows' },
  { key: 'dependencies', label: 'Resolving dependencies' },
  { key: 'finalize', label: 'Finalizing' },
];

const PHASE_INDEX = new Map(PHASES.map((p, i) => [p.key, i]));

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function KgBuilding({ phase }: { phase: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // If phase is null or unrecognised, default to the first phase (structure).
  const activeIndex = phase != null ? (PHASE_INDEX.get(phase) ?? 0) : 0;

  return (
    <div className="flex flex-col gap-5 rounded-card border border-edge bg-surface px-6 py-8">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium text-fg">Building knowledge graph…</h3>
        <p className="text-sm text-fg-faint">
          elapsed {fmt(elapsed)} · this can take a minute
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {PHASES.map((p, i) => {
          const done = i < activeIndex;
          const current = i === activeIndex;
          return (
            <li key={p.key} className="flex items-center gap-2 text-sm">
              <span
                className={
                  done
                    ? 'size-2 rounded-full bg-ok'
                    : current
                      ? 'size-2 animate-pulse rounded-full bg-accent'
                      : 'size-2 rounded-full bg-edge-strong'
                }
              />
              <span className={done ? 'text-fg-muted' : current ? 'text-fg' : 'text-fg-faint'}>{p.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
