import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-card border border-edge bg-surface p-5',
        'transition-colors hover:border-edge-strong',
        className,
      )}
      {...props}
    />
  );
}
