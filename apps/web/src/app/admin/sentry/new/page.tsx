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

const TITLE = 'Add a Sentry connection';

export default function NewSentryConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [sentryOrgSlug, setSentryOrgSlug] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const canSave = !!name.trim() && !!sentryOrgSlug.trim() && !!authToken.trim();

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(), sentryOrgSlug: sentryOrgSlug.trim(), authToken: authToken.trim(),
      };
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      const res = await fetch('/api/integrations/sentry/connections', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/sentry');
    } catch {
      setFormError('Failed to save connection');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <WorkspaceShell org={org}><PageHeader title={TITLE} /><Skeleton rows={4} /></WorkspaceShell>;
  }
  if (unauthorized) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title={TITLE} />
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the Sentry integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/sentry')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Sentry organization slug">
              <Input className="font-mono" value={sentryOrgSlug} placeholder="acme" onChange={(e) => setSentryOrgSlug(e.target.value)} />
            </Field>
            <Field label="Base URL (optional)">
              <Input className="font-mono" value={baseUrl} placeholder="https://sentry.io" onChange={(e) => setBaseUrl(e.target.value)} />
            </Field>
            <Field label="Auth token">
              <Input type="password" value={authToken} placeholder="sntrys_…" onChange={(e) => setAuthToken(e.target.value)} />
            </Field>
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/sentry')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4 text-sm text-fg-muted">
          <p>
            Reusable read-only credentials. Create an organization auth token in Sentry, connect it
            once here, then projects pick this connection and scope it to specific Sentry projects.
          </p>
          <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-5">
            <span className="text-sm font-semibold text-fg">Creating an auth token</span>
            <ol className="list-decimal pl-5">
              <li>In Sentry, open <span className="text-fg">Settings → Auth Tokens</span> (organization level).</li>
              <li>Create a token with the <span className="text-fg font-mono">project:read</span>, <span className="text-fg font-mono">event:read</span>, and <span className="text-fg font-mono">org:read</span> scopes.</li>
              <li>Paste it here along with your organization slug (from the Sentry URL).</li>
            </ol>
            <p className="text-xs text-fg-faint">For self-hosted Sentry, set the Base URL to your instance (e.g. https://sentry.acme.internal).</p>
            <a className="text-accent underline" href="https://sentry.io/settings/auth-tokens/" target="_blank" rel="noreferrer">
              Open Sentry auth tokens →
            </a>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
