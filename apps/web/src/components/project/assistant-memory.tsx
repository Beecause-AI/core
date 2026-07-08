'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchAssistantMemories, addAssistantMemory, deleteAssistantMemory, type AgentMemory } from '../../lib/api';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function AssistantMemory({ slug, assistantId }: { slug: string; assistantId: string }) {
  const [memories, setMemories] = useState<AgentMemory[] | null>(null);
  const [content, setContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reload = () =>
    fetchAssistantMemories(slug, assistantId)
      .then(setMemories)
      .catch(() => setMemories([]));

  useEffect(() => { void reload(); }, [slug, assistantId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setAdding(true);
    setError('');
    try {
      const mem = await addAssistantMemory(slug, assistantId, trimmed);
      setMemories((ms) => [mem, ...(ms ?? [])]);
      setContent('');
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add memory');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this memory? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deleteAssistantMemory(slug, assistantId, id);
      setMemories((ms) => ms?.filter((m) => m.id !== id) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-fg">Private memory</h2>
        <p className="text-sm text-fg-muted">Private memories only this assistant can recall (alongside team memory). Human-curated.</p>

        {/* Add memory box */}
        <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-4">
          <Textarea
            ref={textareaRef}
            className="min-h-[80px] resize-y"
            placeholder="Add a private memory…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAdd();
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-faint">⌘ Enter to save</span>
            <Button disabled={adding || !content.trim()} onClick={() => void handleAdd()}>
              {adding ? 'Saving…' : 'Add memory'}
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-crit">{error}</p>}
      </div>

      {/* Memory list */}
      {memories === null ? (
        <Skeleton rows={3} />
      ) : memories.length === 0 ? (
        <EmptyState
          title="No private memories yet"
          body="Add memories above so this assistant can recall them during incidents."
        />
      ) : (
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          {memories.map((m) => (
            <div key={m.id} className="flex items-start gap-4 px-5 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="whitespace-pre-wrap text-sm text-fg">{m.content}</p>
                <p className="text-xs text-fg-faint">
                  Recalled {m.usageCount} {m.usageCount === 1 ? 'time' : 'times'} · last {formatDate(m.lastRecalledAt)}
                </p>
              </div>
              <div className="shrink-0">
                <Button
                  variant="danger"
                  disabled={deletingId === m.id}
                  onClick={() => void handleDelete(m.id)}
                >
                  {deletingId === m.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
