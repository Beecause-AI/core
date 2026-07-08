import { cn } from './cn';

/** Initials avatar from an email or name. Neutral surface — never brand-colored. */
export function Avatar({ label, className }: { label: string; className?: string }) {
  const initials = label.trim().slice(0, 2).toUpperCase();
  return (
    <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-medium text-fg-muted', className)}>
      {initials}
    </span>
  );
}
