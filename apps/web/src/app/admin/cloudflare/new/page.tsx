'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type CloudflareMode, type OrgInfo } from '../../../../lib/api';
import { CloudflareCredsForm } from '../../../../components/project/cloudflare-connect-wizard';
import { CloudflareStepInstructions } from '../../../../components/project/cloudflare-step-instructions';
import { Button } from '../../../../components/ui/button';
import { Input, Field } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add a Cloudflare connection';

export default function NewCloudflareConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<CloudflareMode>('api_token');
  const [apiToken, setApiToken] = useState('');
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const hasCreds = mode === 'api_token' ? !!apiToken.trim() : !!email.trim() && !!apiKey.trim();
  const accountIdOk = mode === 'api_token' ? !!accountId.trim() : true;
  const canSave = !!name.trim() && hasCreds && accountIdOk;

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const creds = mode === 'api_token'
        ? { mode, apiToken: apiToken.trim() }
        : { mode, email: email.trim(), apiKey: apiKey.trim() };
      const acct = accountId.trim() ? { accountId: accountId.trim() } : {};
      const res = await fetch('/api/integrations/cloudflare/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ...creds, ...acct }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/cloudflare');
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
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the Cloudflare integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/cloudflare')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production account" onChange={(e) => setName(e.target.value)} />
            </Field>
            <CloudflareCredsForm
              mode={mode}
              onModeChange={setMode}
              apiToken={apiToken}
              onApiTokenChange={setApiToken}
              email={email}
              onEmailChange={setEmail}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              accountId={accountId}
              onAccountIdChange={setAccountId}
            />
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/cloudflare')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Reusable read-only credentials. Create a scoped read-only API token, connect it once
            here, then projects pick this connection and scope it to specific zones/accounts.
          </p>
          <CloudflareStepInstructions />
        </div>
      </div>
    </WorkspaceShell>
  );
}
