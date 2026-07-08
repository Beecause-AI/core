import type { ReactNode } from 'react';
import { cn } from './cn';

type Status = 'ok' | 'warn' | 'crit' | 'info' | 'neutral';

const styles: Record<Status, string> = {
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  crit: 'bg-crit/10 text-crit',
  info: 'bg-info/10 text-info',
  neutral: 'border border-edge bg-raised text-fg-muted',
};

export function Badge({ status = 'neutral', children }: { status?: Status; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'text-xs font-semibold uppercase tracking-wide',
        styles[status],
      )}
    >
      {status !== 'neutral' && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
