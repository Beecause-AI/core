'use client';

import { useEffect, useRef, useState } from 'react';
import type { McpTool, IntegrationTool } from '../../lib/api';
import { Input } from '../ui/input';
import { cn } from '../ui/cn';

type ToolEntry = { name: string; description: string; mutates: boolean };
type Group = { key: string; label: string; tools: ToolEntry[] };

// Memory tools known to the engine. Keep in sync with packages/engine ToolRegistry.
const MEMORY_TOOLS: ToolEntry[] = [
  { name: 'memory.recall', description: 'Recall private/team memory from past incidents.', mutates: false },
];

// Incident-history tools known to the engine. Keep in sync with packages/engine ToolRegistry.
const HISTORY_TOOLS: ToolEntry[] = [
  { name: 'recent.search', description: 'Search past incidents on the same/related topic.', mutates: false },
  { name: 'conversations.read', description: 'Read a past conversation thread by id.', mutates: false },
];

// Display names for first-party integration providers; others fall back to a capitalized slug.
const PROVIDER_LABEL: Record<string, string> = { github: 'GitHub', slack: 'Slack', 'knowledge-graph': 'Knowledge Graph', cloudflare: 'Cloudflare', sentry: 'Sentry', grafana: 'Grafana' };

// reads/writes is a capability-risk semantic (does the tool mutate external state?),
// so it maps to status tokens: writes → warn (caution), reads → ok (safe).
const ACCESS_CHIP = {
  writes: 'border-warn/30 bg-warn/10 text-warn',
  reads: 'border-ok/30 bg-ok/10 text-ok',
} as const;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** 'integration.slack.post_message' → 'Post message'; 'builtin.add' → 'Add'. */
function opTitle(name: string): string {
  const segs = name.split('.');
  const op = segs.slice(2).join('_') || segs[segs.length - 1] || name;
  return cap(op.replace(/[._]/g, ' ').trim());
}

/** Group tools by their integration: provider for integration.*, server for mcp.*, plus Memory. */
export function buildGroups(integrationTools: IntegrationTool[], mcpTools: McpTool[]): Group[] {
  const groups = new Map<string, Group>();
  const ensure = (key: string, label: string) => {
    let g = groups.get(key);
    if (!g) { g = { key, label, tools: [] }; groups.set(key, g); }
    return g;
  };
  for (const t of integrationTools) {
    const provider = t.name.split('.')[1] ?? 'integration';
    ensure(`int:${provider}`, PROVIDER_LABEL[provider] ?? cap(provider)).tools.push(t);
  }
  for (const t of mcpTools) {
    const server = t.name.split('.')[1] ?? 'mcp';
    ensure(`mcp:${server}`, `MCP · ${server}`).tools.push({ name: t.name, description: t.description, mutates: t.mutates });
  }
  ensure('memory', 'Memory').tools.push(...MEMORY_TOOLS);
  ensure('history', 'History').tools.push(...HISTORY_TOOLS);
  return [...groups.values()].filter((g) => g.tools.length > 0);
}

function matchesFilter(t: ToolEntry, q: string): boolean {
  const s = q.toLowerCase();
  return opTitle(t.name).toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s);
}

/** Checkbox that renders the indeterminate (partial) state, which is DOM-only. */
function TriCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />;
}

function ToolRow({ tool, checked, onToggle }: { tool: ToolEntry; checked: boolean; onToggle: () => void }) {
  const access = tool.mutates ? 'writes' : 'reads';
  return (
    <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-raised">
      <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">{opTitle(tool.name)}</span>
          <span className={cn('rounded-full border px-1.5 py-0.5 text-xs', ACCESS_CHIP[access])}>{access}</span>
        </span>
        {tool.description && <span className="text-sm text-fg-faint">{tool.description}</span>}
        <span className="truncate font-mono text-xs text-fg-faint">{tool.name}</span>
      </span>
    </label>
  );
}

export function ToolPicker({
  mcpTools, integrationTools = [], value, onChange,
}: {
  mcpTools: McpTool[];
  integrationTools?: IntegrationTool[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState('');
  // Groups default collapsed; a live filter force-expands matching groups.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const has = (n: string) => value.includes(n);
  const toggle = (n: string) => onChange(has(n) ? value.filter((x) => x !== n) : [...value, n]);
  const toggleGroup = (key: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const setGroupAll = (g: Group, on: boolean) => {
    const names = g.tools.map((t) => t.name);
    onChange(on ? [...new Set([...value, ...names])] : value.filter((v) => !names.includes(v)));
  };

  const groups = buildGroups(integrationTools, mcpTools);
  const q = filter.trim();
  const view = groups
    .map((g) => ({ ...g, tools: q ? g.tools.filter((t) => matchesFilter(t, q)) : g.tools }))
    .filter((g) => g.tools.length > 0);
  const totalSelected = groups.reduce((n, g) => n + g.tools.filter((t) => has(t.name)).length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tools…" />
        <span className="shrink-0 text-xs text-fg-faint">{totalSelected} selected</span>
      </div>

      {view.length === 0 ? (
        <p className="text-sm text-fg-faint">No tools match.</p>
      ) : view.map((g) => {
        const sel = g.tools.filter((t) => has(t.name)).length;
        const allOn = sel === g.tools.length;
        const open = q ? true : expanded.has(g.key);
        return (
          <div key={g.key} className="overflow-hidden rounded-card border border-edge bg-surface">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <button type="button" onClick={() => toggleGroup(g.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className={cn('size-4 shrink-0 text-fg-faint transition-transform', open && 'rotate-90')}>
                  <path d="m7 5 5 5-5 5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate text-sm font-medium text-fg">{g.label}</span>
                <span className="shrink-0 text-xs text-fg-faint">{sel} / {g.tools.length}</span>
              </button>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
                <TriCheckbox checked={allOn} indeterminate={sel > 0 && !allOn} onChange={() => setGroupAll(g, !allOn)} />
                Select all
              </label>
            </div>
            {open && (
              <div className="divide-y divide-edge border-t border-edge">
                {g.tools.map((t) => <ToolRow key={t.name} tool={t} checked={has(t.name)} onToggle={() => toggle(t.name)} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
