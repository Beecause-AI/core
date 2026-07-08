'use client';

import { useEffect, useState } from 'react';
import { api, type Assistant } from '../../lib/api';
import { Skeleton } from '../ui/skeleton';
import { AssistantEditor } from './assistant-editor';

/** Full-page assistant editor at /p/{slug}/assistants/{id|new}. Loads the project's
 *  assistants (for the editing target + sub-assistant siblings) and returns to the list
 *  on save/cancel. The list, create, and edit views are distinct pages now. */
export function AssistantEditorPage({ slug, assistantId }: { slug: string; assistantId: string }) {
  const base = `/api/org/projects/${slug}/assistants`;
  const listHref = `/p/${slug}/assistants`;
  const isNew = assistantId === 'new';
  const [assistants, setAssistants] = useState<Assistant[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Assistant[]>(base).then(setAssistants).catch(() => { setAssistants([]); setError('Failed to load assistants.'); });
  }, [base]);

  function back() { window.location.href = listHref; }

  if (assistants === null) return <Skeleton rows={4} />;

  const editing = isNew ? null : (assistants.find((a) => a.id === assistantId) ?? null);
  if (!isNew && !editing) {
    return (
      <p className="text-sm text-crit">
        Assistant not found. <a href={listHref} className="underline">Back to assistants</a>
      </p>
    );
  }

  return (
    <section>
      {error && <p className="mb-3 text-sm text-crit">{error}</p>}
      <AssistantEditor slug={slug} editing={editing} siblings={assistants} onSaved={back} onCancel={back} />
    </section>
  );
}
