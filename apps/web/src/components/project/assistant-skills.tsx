'use client';

import { useEffect, useState } from 'react';
import { fetchSkills, fetchAttachedSkills, setAttachedSkills, type AgentSkill } from '../../lib/api';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';

export function AssistantSkills({ slug, assistantId }: { slug: string; assistantId: string }) {
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSkills(null);
    setError('');
    Promise.all([fetchSkills(slug), fetchAttachedSkills(slug, assistantId)])
      .then(([all, attached]) => {
        setSkills(all);
        setSelectedIds(new Set(attached.map((a) => a.id)));
      })
      .catch(() => {
        setSkills([]);
        setError('Failed to load skills');
      });
  }, [slug, assistantId]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await setAttachedSkills(slug, assistantId, [...selectedIds]);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save attachments');
    } finally {
      setSaving(false);
    }
  }

  if (skills === null) return <Skeleton rows={3} />;
  if (error && skills.length === 0) return <p className="text-sm text-crit">{error}</p>;

  if (skills.length === 0) {
    return (
      <EmptyState
        title="No skills in this project"
        body="Create skills on the project Skills tab, then attach them here."
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-fg">Skills</h2>
        <p className="text-sm text-fg-faint">Select the skills this assistant can use.</p>
      </div>

      <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
        {skills.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-raised">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={selectedIds.has(s.id)}
              onChange={() => toggle(s.id)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-fg">{s.name}</span>
              {s.description && <span className="text-xs text-fg-faint">{s.description}</span>}
            </div>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-crit">{error}</p>}

      <div className="flex items-center gap-3">
        <Button disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save attachments'}
        </Button>
        {saved && <span className="text-sm text-fg-faint">Saved</span>}
      </div>
    </section>
  );
}
