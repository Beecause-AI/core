'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type OrgInfo } from '../../../../lib/api';
import { DynatraceCredsForm } from '../../../../components/project/dynatrace-creds-form';
import { DynatraceStepInstructions } from '../../../../components/project/dynatrace-step-instructions';
import { Button } from '../../../../components/ui/button';
import { Input, Field } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add a Dynatrace connection';

export default function NewDynatraceConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [environmentUrl, setEnvironmentUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const canSave = !!name.trim() && !!environmentUrl.trim() && !!apiToken.trim();

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/dynatrace/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          environmentUrl,
          apiToken,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/dynatrace');
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
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the Dynatrace integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/dynatrace')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} />
            </Field>
            <DynatraceCredsForm
              environmentUrl={environmentUrl}
              onEnvironmentUrlChange={setEnvironmentUrl}
              apiToken={apiToken}
              onApiTokenChange={setApiToken}
            />
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/dynatrace')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Reusable read-only credentials. Create an API token in your Dynatrace environment, then connect it
            once here — projects pick this connection and scope it to specific management zones and services.
          </p>
          <DynatraceStepInstructions />
        </div>
      </div>
    </WorkspaceShell>
  );
}
