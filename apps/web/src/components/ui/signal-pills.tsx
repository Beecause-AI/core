export type SignalSection = { key: string; label: string };

/** One pill per signal/section, driven by the persisted last-check result.
 *  checked=false (never verified) → neutral "not checked"; checked & available → ok; checked & not available → crit. */
export function SignalPills({
  sections,
  available,
  checked,
  errors,
}: {
  sections: SignalSection[];
  available: string[] | null | undefined;
  checked: boolean;
  errors?: Record<string, string | undefined>;
}) {
  const avail = new Set(available ?? []);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sections.map((s) => {
        const state = !checked ? 'neutral' : avail.has(s.key) ? 'ok' : 'crit';
        const cls =
          state === 'ok'
            ? 'bg-ok/10 text-ok'
            : state === 'crit'
              ? 'bg-crit/10 text-crit'
              : 'bg-raised text-fg-muted border border-edge';
        const mark = state === 'ok' ? '✓' : state === 'crit' ? '✗' : '•';
        const title =
          state === 'ok'
            ? 'available at last check'
            : state === 'crit'
              ? (errors?.[s.key] ?? 'unavailable at last check')
              : 'not checked yet';
        return (
          <span
            key={s.key}
            title={title}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
          >
            <span aria-hidden>{mark}</span>
            {s.label}
          </span>
        );
      })}
    </div>
  );
}
