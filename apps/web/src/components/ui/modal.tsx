'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';

/** Minimal, on-system dialog: dimmed canvas backdrop + a centered surface card.
 *  Closes on Escape or backdrop click. Body region scrolls when content overflows. */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn('flex max-h-[80vh] w-full max-w-2xl flex-col rounded-card border border-edge bg-surface', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="text-lg font-medium text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-faint transition-colors hover:bg-raised hover:text-fg"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="size-5">
              <path d="m5 5 10 10M15 5 5 15" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
