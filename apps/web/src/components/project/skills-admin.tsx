'use client';

import { useEffect, useState } from 'react';
import { fetchSkills, createSkill, updateSkill, deleteSkill, type AgentSkill } from '../../lib/api';
import { Button } from '../ui/button';
import { Input, Textarea, Field } from '../ui/input';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';

type EditingState = {
  id: string | null; // null = new
  name: string;
  description: string;
  body: string;
};

const EMPTY_FORM: EditingState = { id: null, name: '', description: '', body: '' };

export function SkillsAdmin({ slug }: { slug: string }) {
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reload = () =>
    fetchSkills(slug)
      .then(setSkills)
      .catch(() => setSkills([]));

  useEffect(() => { void reload(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!editing) return;
    const { id, name, description, body } = editing;
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (id) {
        const updated = await updateSkill(slug, id, { name: name.trim(), description: description.trim(), body: body.trim() });
        setSkills((ss) => ss?.map((s) => s.id === id ? updated : s) ?? []);
      } else {
        const created = await createSkill(slug, { name: name.trim(), description: description.trim(), body: body.trim() });
        setSkills((ss) => [created, ...(ss ?? [])]);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this skill? Assistants that use it will lose it immediately.')) return;
    setDeletingId(id);
    setError('');
    try {
      await deleteSkill(slug, id);
      setSkills((ss) => ss?.filter((s) => s.id !== id) ?? []);
      if (editing?.id === id) setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-fg">Skills</h2>
          <p className="text-sm text-fg-faint">Reusable instruction modules. Attach them to assistants on the Assistants tab.</p>
        </div>
        {!editing && (
          <Button onClick={() => setEditing(EMPTY_FORM)}>New skill</Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-col gap-4 rounded-card border border-edge bg-surface p-4">
          <h3 className="text-sm font-semibold text-fg">{editing.id ? 'Edit skill' : 'New skill'}</h3>
          <Field label="Name">
            <Input
              value={editing.name}
              onChange={(e) => setEditing((ed) => ed && { ...ed, name: e.target.value })}
              placeholder="e.g. Triage runbook"
              required
            />
          </Field>
          <Field label="Description">
            <Input
              value={editing.description}
              onChange={(e) => setEditing((ed) => ed && { ...ed, description: e.target.value })}
              placeholder="One-line description shown in the attach list"
            />
          </Field>
          <Field label="Body — instructions injected into the assistant">
            <Textarea
              className="min-h-[160px] font-mono"
              value={editing.body}
              onChange={(e) => setEditing((ed) => ed && { ...ed, body: e.target.value })}
              placeholder="Write the skill instructions here…"
            />
          </Field>
          {error && <p className="text-sm text-crit">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setEditing(null); setError(''); }}>Cancel</Button>
            <Button
              type="button"
              disabled={saving || !editing.name.trim() || !editing.body.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {!editing && error && <p className="text-sm text-crit">{error}</p>}

      {skills === null ? (
        <Skeleton rows={3} />
      ) : skills.length === 0 ? (
        <EmptyState
          title="No skills yet"
          body="Create a skill to add reusable instruction modules to your assistants."
        />
      ) : (
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          {skills.map((s) => (
            <div key={s.id} className="flex items-start gap-4 px-5 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-medium text-fg">{s.name}</p>
                {s.description && <p className="text-xs text-fg-faint">{s.description}</p>}
                <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-fg-faint line-clamp-3">{s.body}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditing({ id: s.id, name: s.name, description: s.description, body: s.body })}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  disabled={deletingId === s.id}
                  onClick={() => void handleDelete(s.id)}
                >
                  {deletingId === s.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
