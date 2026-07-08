'use client';

import { useEffect, useState } from 'react';
import { api, type OrgInfo, type Project } from '../../../lib/api';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Field, Input, Textarea } from '../../../components/ui/input';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function NewProjectPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org').then(setOrg).catch(() => {/* redirect handled by api() */});
  }, []);
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugEdited) {
      setSlug(toSlug(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlug(value);
    setSlugEdited(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const created = await api<Project>('/api/org/projects', {
        method: 'POST',
        body: JSON.stringify({ name, slug, description }),
      });
      window.location.href = `/p/${created.slug}`;
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 409) {
        setError('That slug is already taken. Choose a different one.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create project');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader
        title="New project"
        actions={
          <Button variant="secondary" onClick={() => (window.location.href = '/')}>
            Cancel
          </Button>
        }
      />
      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My project"
              required
            />
          </Field>
          <Field label="Slug">
            <Input
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="my-project"
              pattern="^[a-z0-9][a-z0-9-]{1,38}$"
              title="Lowercase letters, numbers and hyphens only. Must start with a letter or number."
              required
              className="font-mono"
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this project scope? (optional)"
            />
          </Field>
          {error && <p className="text-sm text-crit">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !name || !slug}>
              {saving ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </form>
      </Card>
    </WorkspaceShell>
  );
}
