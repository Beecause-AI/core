'use client';

import { useEffect, useState } from 'react';
import { api, type ApiKey, type OrgInfo } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/input';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';

export default function ApiKeysPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState(''); // yyyy-mm-dd or ''
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null); // plaintext shown once

  useEffect(() => {
    Promise.all([
      api<OrgInfo>('/api/org').catch(() => null),
      api<ApiKey[]>('/api/keys'),
    ])
      .then(([o, k]) => { setOrg(o); setKeys(k); })
      .catch((e: { message?: string }) => setError(e?.message ?? 'Failed to load API keys'))
      .finally(() => setLoading(false));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setNewKey(null);
    try {
      const body: { name: string; expiresAt?: string } = { name: name.trim() };
      // Send end-of-day so a same-day expiry isn't already in the past.
      if (expiresAt) body.expiresAt = new Date(`${expiresAt}T23:59:59`).toISOString();
      const res = await api<{ key: string; row: ApiKey }>('/api/keys', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNewKey(res.key);
      setKeys((xs) => [res.row, ...xs]);
      setName('');
      setExpiresAt('');
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      setError(apiErr?.message ?? 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError('');
    try {
      await api<void>(`/api/keys/${id}`, { method: 'DELETE' });
      setKeys((xs) => xs.filter((k) => k.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  }

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="API keys" />
        <Skeleton rows={3} />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="API keys" />

      <div className="flex flex-col gap-8">
        <form onSubmit={create} className="flex max-w-xl items-end gap-2">
          <div className="flex-1">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="CI server" />
            </Field>
          </div>
          <Field label="Expires (optional)">
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-44" />
          </Field>
          <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create key'}</Button>
        </form>

        {newKey && (
          <div className="rounded-card border border-ok/40 bg-ok/10 p-4">
            <p className="mb-2 text-sm text-fg">
              Copy your new key now — it won’t be shown again.
            </p>
            <code className="block break-all rounded-md bg-canvas px-3 py-2 font-mono text-sm text-fg">{newKey}</code>
          </div>
        )}

        {error && <p className="text-sm text-crit">{error}</p>}

        {keys.length === 0 ? (
          <EmptyState title="No API keys" body="Create a key to call the API as yourself." />
        ) : (
          <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
            {keys.map((k) => {
              const expired = k.expiresAt !== null && new Date(k.expiresAt).getTime() < Date.now();
              return (
                <div key={k.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm text-fg">{k.name}</span>
                    <span className="font-mono text-xs text-fg-faint">{k.keyPrefix}…</span>
                  </div>
                  <div className="flex flex-col items-end text-xs text-fg-faint">
                    <span>{expired ? 'Expired' : k.expiresAt ? `Expires ${new Date(k.expiresAt).toLocaleDateString()}` : 'No expiry'}</span>
                    <span>{k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'Never used'}</span>
                  </div>
                  <Button variant="danger" onClick={() => void revoke(k.id)}>Revoke</Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
