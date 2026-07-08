import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-edge-strong bg-raised text-fg hover:border-fg-faint',
  ghost: 'text-fg-muted hover:bg-raised hover:text-fg',
  danger: 'border border-crit/40 bg-crit/10 text-crit hover:bg-crit/20',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium',
        'transition-colors disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
