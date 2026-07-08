'use client';

import { useEffect, useState } from 'react';
import { api, fetchModelGroups, fetchMcpTools, fetchIntegrationTools, type Assistant, type GroupProvider, type IntegrationTool, type McpTool, type ModelGroup, type OrgInfo } from '../../lib/api';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/input';
import { MarkdownEditor } from '../ui/markdown-editor';
import { cn } from '../ui/cn';
import { ModelPicker, type ModelValue } from './model-picker';
import { ToolPicker } from './tool-picker';
import { SubAssistantPicker } from './sub-assistant-picker';
import { DebugPromptPreview } from './debug-prompt-preview';
import { AssistantMemory } from './assistant-memory';
import { AssistantSkills } from './assistant-skills';

type Tab = 'general' | 'model' | 'tools' | 'subagents' | 'memory' | 'skills';
const TAB_LABELS: Record<Tab, string> = { general: 'General', model: 'Model', tools: 'Tools', subagents: 'Sub-assistants', memory: 'Memory', skills: 'Skills' };

export function AssistantEditor({
  slug, editing, siblings, onSaved, onCancel,
}: {
  slug: string;
  editing?: Assistant | null;
  siblings: Assistant[];
  onSaved: (a: Assistant) => void;
  onCancel: () => void;
}) {
  const base = `/api/org/projects/${slug}/assistants`;
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState(editing?.name ?? '');
  const [persona, setPersona] = useState(editing?.persona ?? '');
  const [model, setModel] = useState<ModelValue | null>(editing?.model ? { model: editing.model, provider: (editing.provider as GroupProvider) ?? 'platform' } : null);
  const [enabledTools, setEnabledTools] = useState<string[]>(editing?.enabledTools ?? []);
  const [isLead, setIsLead] = useState(editing?.isLead ?? false);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [integrationTools, setIntegrationTools] = useState<IntegrationTool[]>([]);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchModelGroups(slug).then((gs) => setGroups(gs.filter((g) => g.source === 'platform'))).catch(() => setGroups([])); }, [slug]);
  useEffect(() => { fetchMcpTools(slug).then(setMcpTools).catch(() => setMcpTools([])); }, [slug]);
  useEffect(() => { fetchIntegrationTools(slug).then(setIntegrationTools).catch(() => setIntegrationTools([])); }, [slug]);
  useEffect(() => { api<OrgInfo>('/api/org').then((o) => { setDebugEnabled(o.debugEnabled); }).catch(() => {}); }, []);

  const toolCount = enabledTools.filter((t) => t.startsWith('mcp.') || t.startsWith('builtin.') || t.startsWith('integration.')).length;
  const agentCount = enabledTools.filter((t) => t.startsWith('agent.')).length;
  const COUNTS: Record<Tab, number | null> = { general: null, model: null, tools: toolCount, subagents: agentCount, memory: null, skills: null };

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const body = JSON.stringify({ name, persona, model: model?.model, provider: model?.provider, enabledTools, isLead });
      const saved = editing
        ? await api<Assistant>(`${base}/${editing.id}`, { method: 'PATCH', body })
        : await api<Assistant>(base, { method: 'POST', body });
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  // Self-delegation guard: an assistant can't delegate to itself, so exclude it from the
  // selectable sub-assistant list. TODO: also exclude targets that already (transitively)
  // delegate back to this assistant to prevent cycles — the editor only has shallow sibling
  // data here, so the deterministic breakDelegationCycles in core is the real guarantee.
  const siblingsExcludingSelf = siblings.filter((s) => s.id !== editing?.id);

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <nav role="tablist" className="flex gap-6 border-b border-edge">
        {(Object.keys(TAB_LABELS) as Tab[]).filter((t) => (t !== 'memory' && t !== 'skills') || !!editing).map((t) => (
          <button
            key={t} type="button" role="tab" aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 px-0.5 pb-3 text-sm', tab === t ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
          >
            {TAB_LABELS[t]}{COUNTS[t] ? ` (${COUNTS[t]})` : ''}
          </button>
        ))}
      </nav>

      {tab === 'general' && (
        <div className="flex flex-col gap-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My assistant" required /></Field>
          <Field label="Persona — Markdown, grows as you type">
            <MarkdownEditor value={persona} onChange={setPersona} placeholder="You are a helpful assistant…" />
          </Field>
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-0.5" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} />
            <span>
              Orchestrator
              <span className="block text-xs text-fg-faint">Routes and delegates the team; exactly one per project.</span>
            </span>
          </label>
        </div>
      )}
      {tab === 'model' && <ModelPicker groups={groups} value={model} onChange={setModel} />}
      {tab === 'tools' && <ToolPicker mcpTools={mcpTools} integrationTools={integrationTools} value={enabledTools} onChange={setEnabledTools} />}
      {tab === 'subagents' && <SubAssistantPicker siblings={siblingsExcludingSelf} value={enabledTools} onChange={setEnabledTools} />}
      {tab === 'memory' && editing && <AssistantMemory slug={slug} assistantId={editing.id} />}
      {tab === 'skills' && editing && <AssistantSkills slug={slug} assistantId={editing.id} />}

      {debugEnabled && (
        <DebugPromptPreview
          slug={slug}
          body={editing ? { assistantId: editing.id } : { persona, enabledTools, isLead }}
        />
      )}

      {error && <p className="text-sm text-crit">{error}</p>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-faint">{model ? `${model.model} · ${model.provider}` : 'No model selected'}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={saving || !name || !model}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}</Button>
        </div>
      </div>
    </form>
  );
}
