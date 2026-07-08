'use client';

/** Ordered phases must match packages/core TEAM_AUTOGEN_PHASES (web can't import core). */
const PHASES: { key: string; label: string }[] = [
  { key: 'analyzing', label: 'Reading your code & signals' },
  { key: 'mapping', label: 'Mapping your system' },
  { key: 'designing', label: 'Designing the team' },
  { key: 'reviewing', label: 'Reviewing & refining' },
  { key: 'finalizing', label: 'Finalizing' },
];

/** Friendly live progress: a phase checklist (done ✓ / ongoing ⟳ / pending ·) + a bar.
 *  `progress` is the current TeamAutogenPhase key (null until the worker reports one). */
export function GenerationProgress({ progress }: { progress: string | null }) {
  const current = Math.max(0, PHASES.findIndex((p) => p.key === progress));
  const pct = Math.round(((current + 1) / PHASES.length) * 100);
  return (
    <div className="flex flex-col gap-5 rounded-card border border-edge bg-surface px-6 py-8">
      <div className="flex flex-col gap-1 text-center">
        <h3 className="text-base font-semibold text-fg">Designing your team…</h3>
        <p className="text-sm text-fg-muted">This usually takes about a minute. You can leave this page — we’ll keep working.</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-col gap-2">
        {PHASES.map((p, i) => {
          const done = i < current;
          const ongoing = i === current;
          return (
            <li key={p.key} className="flex items-center gap-3 text-sm">
              <span
                className={
                  done ? 'flex size-5 items-center justify-center rounded-full bg-ok/15 text-ok'
                  : ongoing ? 'flex size-5 items-center justify-center rounded-full border border-accent text-accent'
                  : 'flex size-5 items-center justify-center rounded-full border border-edge text-fg-faint'
                }
              >
                {done ? '✓' : ongoing ? <span className="size-2 animate-pulse rounded-full bg-accent" /> : ''}
              </span>
              <span className={done ? 'text-fg-muted' : ongoing ? 'font-medium text-fg' : 'text-fg-faint'}>{p.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
