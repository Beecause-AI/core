import { cn } from './cn';

/** A simple numbered step indicator. `current` is the 0-based active step. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} data-current={active} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                active ? 'bg-accent text-on-accent' : done ? 'bg-accent/20 text-accent' : 'bg-raised text-fg-faint',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={cn('text-sm', active ? 'font-medium text-fg' : 'text-fg-faint')}>{label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-edge" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
