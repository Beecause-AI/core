'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type OrgInfo } from '../../../../lib/api';
import { Button } from '../../../../components/ui/button';
import { Input, Field } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add a Grafana connection';

export default function NewGrafanaConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const canSave = !!name.trim() && !!baseUrl.trim() && !!token.trim();

  async function save() {
    setFormError(''); setBusy(true);
    try {
      const body = { name: name.trim(), baseUrl: baseUrl.trim(), token: token.trim() };
      const res = await fetch('/api/integrations/grafana/connections', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection'); return;
      }
      router.push('/admin/grafana');
    } catch {
      setFormError('Failed to save connection');
    } finally { setBusy(false); }
  }

  if (loading) return <WorkspaceShell org={org}><PageHeader title={TITLE} /><Skeleton rows={4} /></WorkspaceShell>;
  if (unauthorized) return (
    <WorkspaceShell org={org}><PageHeader title={TITLE} />
      <EmptyState title="Not authorized" body="Only org owners and managers can manage the Grafana integration." />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/grafana')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name"><Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Base URL"><Input className="font-mono" value={baseUrl} placeholder="https://grafana.acme.io" onChange={(e) => setBaseUrl(e.target.value)} /></Field>
            <Field label="Service account token"><Input type="password" value={token} placeholder="glsa_…" onChange={(e) => setToken(e.target.value)} /></Field>
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/grafana')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4 text-sm text-fg-muted">
          <p>
            Reusable read-only credentials. Create a Grafana service-account token with the
            <span className="text-fg"> Viewer</span> role, connect it once here, then projects pick this
            connection and scope it to specific datasources.
          </p>
          <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-5">
            <span className="text-sm font-semibold text-fg">Creating a service-account token</span>
            <ol className="list-decimal pl-5">
              <li>In Grafana, open <span className="text-fg">Administration → Service accounts</span>.</li>
              <li>Create a service account with the <span className="text-fg font-mono">Viewer</span> role and add a token.</li>
              <li>Paste the token here along with your Grafana base URL.</li>
            </ol>
            <p className="text-xs text-fg-faint">Works with Grafana Cloud and self-hosted Grafana — set the Base URL to your instance.</p>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
