'use client';

import { useState } from 'react';
import type { ThreadEvent } from '../../lib/api';
import { cn } from '../ui/cn';

type Tool = Extract<ThreadEvent, { kind: 'tool' }>;

export function ToolChip({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  const ok = tool.status === 'ok';
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-edge bg-raised px-2.5 py-1.5 text-left text-xs text-fg-muted hover:border-edge-strong"
      >
        <span className={cn('size-1.5 rounded-full', ok ? 'bg-ok' : 'bg-crit')} aria-hidden />
        <span aria-hidden>🔧</span>
        <span className="font-mono text-fg">{tool.name}</span>
        {tool.latencyMs != null && <span className="text-fg-faint">· {tool.latencyMs}ms</span>}
        <span className="ml-auto text-fg-faint">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded-lg border border-edge bg-canvas px-3 py-2 font-mono text-[11px] text-fg-muted">
          {tool.input != null && (<div><div className="text-fg-faint">input</div><pre className="whitespace-pre-wrap break-words">{tool.input}</pre></div>)}
          {tool.output != null && (<div><div className="text-fg-faint">output</div><pre className="whitespace-pre-wrap break-words">{tool.output}</pre></div>)}
          {tool.error && (<div className="text-crit">{tool.error}</div>)}
          {tool.truncated && (<div className="text-fg-faint">… truncated</div>)}
        </div>
      )}
    </div>
  );
}
