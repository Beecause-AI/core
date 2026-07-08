'use client';

import { useEffect, useState } from 'react';
import { api, type Me, type OrgInfo } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/input';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';

function splitName(name?: string): { first: string; last: string } {
  const [first, ...rest] = (name ?? '').trim().split(' ');
  return { first: first ?? '', last: rest.join(' ') };
}

export default function ProfilePage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api<OrgInfo>('/api/org').catch(() => null),
      api<Me>('/api/me'),
    ])
      .then(([o, me]) => {
        setOrg(o);
        const { first, last } = splitName(me.name);
        setFirstName(first);
        setLastName(last);
        setEmail(me.email ?? '');
      })
      .catch((e: { message?: string }) => setError(e?.message ?? 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await api<{ name: string }>('/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      const { first, last } = splitName(res.name);
      setFirstName(first);
      setLastName(last);
      setSaved(true);
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      setError(apiErr?.status === 400 ? 'First and last name are required.' : (apiErr?.message ?? 'Failed to save'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Profile" />
        <Skeleton rows={3} />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Profile" />
      <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
        {email && (
          <Field label="Email">
            <Input value={email} disabled />
          </Field>
        )}
        <Field label="First name">
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </Field>
        <Field label="Last name">
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {saved && <span className="text-sm text-ok">Saved.</span>}
          {error && <span className="text-sm text-crit">{error}</span>}
        </div>
      </form>
    </WorkspaceShell>
  );
}
