'use client';

import { useState } from 'react';
import { api, setProjectReportsEnabled, type ProjectDetail } from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/input';

export function SettingsTab({ project }: { project: ProjectDetail }) {
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);
  const [reportsEnabled, setReportsEnabled] = useState(project.reportsEnabled ?? false);
  const [reportsBusy, setReportsBusy] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingSlug, setSavingSlug] = useState(false);
  const [error, setError] = useState('');

  async function saveName() {
    setSavingName(true);
    setError('');
    try {
      await api<ProjectDetail>(`/api/org/projects/${project.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingName(false);
    }
  }

  async function saveSlug() {
    if (
      !confirm(
        "Changing the slug changes this project’s URL. Existing links will stop working. Continue?",
      )
    )
      return;
    setSavingSlug(true);
    setError('');
    try {
      await api<ProjectDetail>(`/api/org/projects/${project.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ slug }),
      });
      window.location.href = `/p/${slug}`;
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError(
        err?.status === 409
          ? 'That slug is already taken.'
          : (err?.message ?? 'Failed to save'),
      );
      setSavingSlug(false);
    }
  }

  async function del() {
    if (
      !confirm(
        `Delete project "${project.name}"? This removes its assistants, members and scoped repos. This cannot be undone.`,
      )
    )
      return;
    try {
      await api<void>(`/api/org/projects/${project.slug}`, { method: 'DELETE' });
      window.location.href = '/';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  async function toggleReports(value: boolean) {
    setReportsBusy(true); setReportsError('');
    const prev = reportsEnabled;
    setReportsEnabled(value);
    try {
      await setProjectReportsEnabled(project.slug, value);
    } catch (e) {
      setReportsEnabled(prev);
      setReportsError((e as { message?: string })?.message ?? 'Failed to update');
    } finally { setReportsBusy(false); }
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      {error && <p className="text-sm text-crit">{error}</p>}
      <Card>
        <h3 className="mb-3 text-base font-semibold">Name</h3>
        <Field label="Project name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button onClick={saveName} disabled={savingName || !name}>
            {savingName ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>
      <Card>
        <h3 className="mb-3 text-base font-semibold">Slug</h3>
        <Field label="URL slug">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="^[a-z0-9][a-z0-9-]{1,38}$"
            className="font-mono"
            title="Lowercase letters, numbers and hyphens. Must start with a letter or number."
          />
        </Field>
        <p className="mt-2 text-xs text-fg-faint">
          Used in this project&apos;s URL. Changing it breaks existing links.
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            onClick={saveSlug}
            disabled={savingSlug || !slug || slug === project.slug}
          >
            {savingSlug ? 'Saving…' : 'Change slug'}
          </Button>
        </div>
      </Card>
      <Card>
        <h3 className="mb-3 text-base font-semibold">Features</h3>
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-fg">Investigation reports</span>
              <span className="text-xs text-fg-faint">Allow assistants to offer incident reports in this project.</span>
            </div>
            <Button
              variant={reportsEnabled ? 'secondary' : 'ghost'}
              disabled={reportsBusy}
              onClick={() => void toggleReports(!reportsEnabled)}
            >{reportsEnabled ? 'On' : 'Off'}</Button>
          </div>
          {reportsError && <p className="text-sm text-crit">{reportsError}</p>}
        </div>
      </Card>
      <Card className="border-crit/40">
        <h3 className="mb-1 text-base font-semibold text-crit">Danger zone</h3>
        <p className="mb-3 text-sm text-fg-muted">Deleting a project is permanent.</p>
        <div className="flex justify-end">
          <Button variant="danger" onClick={del}>
            Delete project
          </Button>
        </div>
      </Card>
    </div>
  );
}
