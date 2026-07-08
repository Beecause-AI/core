import type { ReactNode } from 'react';

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex items-center justify-between gap-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
