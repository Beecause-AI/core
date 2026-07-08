'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type GcpMode, type OrgInfo } from '../../../../lib/api';
import { GcpCredsForm } from '../../../../components/project/gcp-creds-form';
import { GcpStepInstructions } from '../../../../components/project/gcp-step-instructions';
import { Button } from '../../../../components/ui/button';
import { Input, Field } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add a Google Cloud connection';

export default function NewGcpConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<GcpMode>('sa_key');
  const [saKey, setSaKey] = useState('');
  const [wifConfig, setWifConfig] = useState('');
  const [defaultGcpProjectId, setDefaultGcpProjectId] = useState('');
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const hasCreds = mode === 'sa_key' ? !!saKey.trim() : !!wifConfig.trim();
  const canSave = !!name.trim() && hasCreds && !!defaultGcpProjectId.trim();

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const creds = mode === 'sa_key' ? { mode, saKey: saKey.trim() } : { mode, wifConfig: wifConfig.trim() };
      const res = await fetch('/api/integrations/gcp/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), defaultGcpProjectId: defaultGcpProjectId.trim(), ...creds }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/gcp');
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
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the Google Cloud integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/gcp')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production account" onChange={(e) => setName(e.target.value)} />
            </Field>
            <GcpCredsForm
              mode={mode}
              onModeChange={setMode}
              saKey={saKey}
              onSaKeyChange={setSaKey}
              wifConfig={wifConfig}
              onWifConfigChange={setWifConfig}
              defaultGcpProjectId={defaultGcpProjectId}
              onDefaultGcpProjectIdChange={setDefaultGcpProjectId}
              saEmail={saEmail}
              onSaEmailChange={setSaEmail}
            />
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/gcp')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Reusable read-only credentials. Grant one service account the read roles across the GCP
            projects you want assistants to query, then connect it once here — projects pick this
            connection and scope it to specific GCP projects.
          </p>
          <GcpStepInstructions />
        </div>
      </div>
    </WorkspaceShell>
  );
}
