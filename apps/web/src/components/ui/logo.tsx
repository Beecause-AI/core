import { cn } from './cn';

/** Beecause mark (honeycomb cell with knocked-out "B") + optional wordmark.
 *  The one place the brand artwork lives, analogous to globals.css owning tokens. */
export function Logo({
  variant = 'full',
  className,
}: {
  variant?: 'full' | 'mark';
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 24 24" className="size-5 text-accent" aria-hidden>
        <polygon points="12,1.4 21.18,6.7 21.18,17.3 12,22.6 2.82,17.3 2.82,6.7" fill="currentColor" />
        <text x="12" y="12.7" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="800" fill="var(--color-canvas)" style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>B</text>
      </svg>
      {variant === 'full' && (
        <span className="text-sm font-semibold tracking-tight text-fg">
          <span className="text-accent">Bee</span>cause
        </span>
      )}
    </span>
  );
}
