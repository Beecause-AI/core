import { cn } from './cn';
import type { AiProviderId } from '../../lib/ai-providers';

/** Neutral, monochrome provider glyphs — `currentColor` only, no brand hues.
 *  Each is a simple geometric mark inside the standard tool-mark container. */
const MARKS: Record<AiProviderId, React.ReactNode> = {
  // Anthropic — angular "A" caret.
  anthropic: (
    <path d="M12 4l5.5 14h-2.4l-1.2-3.2H8.1L6.9 18H4.5L10 4h2zm-3.1 8.6h4.2L11 6.8 8.9 12.6z" fill="currentColor" />
  ),
  // OpenAI — six-fold interlocking knot, simplified to a ring of nodes.
  openai: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5v14M5.9 8.5l12.2 7M5.9 15.5l12.2-7" />
    </g>
  ),
  // Google (Gemini) — four-point spark.
  google: (
    <path d="M12 3c.6 4.3 1.7 5.4 6 6-4.3.6-5.4 1.7-6 6-.6-4.3-1.7-5.4-6-6 4.3-.6 5.4-1.7 6-6z" fill="currentColor" />
  ),
  // OpenAI-compatible — generic sliders glyph.
  'openai-compatible': (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M5 8h14M5 16h14" />
      <circle cx="9" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="2" fill="currentColor" stroke="none" />
    </g>
  ),
};

export function ProviderMark({ provider, className }: { provider: AiProviderId; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-edge-strong bg-raised text-fg-muted',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        {MARKS[provider]}
      </svg>
    </span>
  );
}
