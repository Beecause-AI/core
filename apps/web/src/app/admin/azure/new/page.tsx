'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type AzureMode, type OrgInfo } from '../../../../lib/api';
import { AzureCredsForm } from '../../../../components/project/azure-creds-form';
import { AzureStepInstructions } from '../../../../components/project/azure-step-instructions';
import { Button } from '../../../../components/ui/button';
import { Input, Field } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add an Azure connection';

export default function NewAzureConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<AzureMode>('service_principal');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [defaultSubscriptionId, setDefaultSubscriptionId] = useState('');
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const canSave = !!name.trim() && !!tenantId.trim() && !!clientId.trim() && !!defaultSubscriptionId.trim() && (mode === 'workload_identity' ? true : !!clientSecret.trim());

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/azure/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          tenantId: tenantId.trim(),
          clientId: clientId.trim(),
          defaultSubscriptionId: defaultSubscriptionId.trim(),
          defaultWorkspaceId: defaultWorkspaceId.trim() || undefined,
          ...(mode === 'service_principal' ? { clientSecret } : {}),
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/azure');
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
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the Azure integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/azure')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production subscription" onChange={(e) => setName(e.target.value)} />
            </Field>
            <AzureCredsForm
              mode={mode}
              onModeChange={setMode}
              tenantId={tenantId}
              onTenantIdChange={setTenantId}
              clientId={clientId}
              onClientIdChange={setClientId}
              clientSecret={clientSecret}
              onClientSecretChange={setClientSecret}
              defaultSubscriptionId={defaultSubscriptionId}
              onDefaultSubscriptionIdChange={setDefaultSubscriptionId}
              defaultWorkspaceId={defaultWorkspaceId}
              onDefaultWorkspaceIdChange={setDefaultWorkspaceId}
            />
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/azure')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Reusable read-only credentials. Grant a service principal or workload identity read permissions across
            the Azure subscriptions you want assistants to query, then connect it once here — projects pick
            this connection and scope it to specific Azure subscriptions.
          </p>
          <AzureStepInstructions />
        </div>
      </div>
    </WorkspaceShell>
  );
}
