import { cn } from './cn';

export type Crumb = { label: string; href?: string };

/** Breadcrumb for drill-down/detail views — clickable ancestors, plain current. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-2 text-sm">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-2">
            {c.href && !last ? (
              <a href={c.href} className="text-fg-muted no-underline transition-colors hover:text-fg">{c.label}</a>
            ) : (
              <span className={cn(last ? 'font-medium text-fg' : 'text-fg-muted')}>{c.label}</span>
            )}
            {!last && <span className="text-fg-faint">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
