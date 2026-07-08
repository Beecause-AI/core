import type { ReactNode } from 'react';
import { Logo } from './logo';

export function EmptyState({
  title,
  body,
  action,
  mark = false,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  mark?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-edge-strong px-6 py-16 text-center">
      {mark && <Logo variant="mark" className="opacity-20 [&_svg]:size-8" />}
      <p className="text-lg font-medium">{title}</p>
      {body && <p className="max-w-sm text-sm text-fg-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
