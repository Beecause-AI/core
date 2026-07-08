'use client';

import { useState } from 'react';
import { fetchPromptPreview, type PromptPreviewBody } from '../../lib/api';
import { cn } from '../ui/cn';

/** Collapsible "System prompt (debug)" panel. Lazily fetches the fully-assembled
 *  prompt (persona + RCA preamble + integration skills) on first expand.
 *  Caller is responsible for only rendering this when the org debug flag is on. */
export function DebugPromptPreview({ slug, body }: { slug: string; body: PromptPreviewBody }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const { prompt } = await fetchPromptPreview(slug, body);
      setPrompt(prompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prompt');
    } finally { setLoading(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && prompt == null && !loading) void load();
  }

  return (
    <div className="rounded-card border border-edge bg-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-fg-faint hover:text-fg"
      >
        <span>System prompt (debug)</span>
        <span className={cn('transition-transform', open && 'rotate-90')}>›</span>
      </button>
      {open && (
        <div className="border-t border-edge px-3 py-2">
          {loading && <p className="text-xs text-fg-muted">Assembling…</p>}
          {error && <p className="text-xs text-crit">{error}</p>}
          {prompt != null && !loading && (
            <div className="flex flex-col gap-2">
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-canvas p-3 font-mono text-xs text-fg-muted">{prompt}</pre>
              <button type="button" onClick={() => void load()} className="self-start text-xs text-accent hover:underline">Refresh</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
