'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type AwsMode, type OrgInfo } from '../../../../lib/api';
import { AwsCredsForm } from '../../../../components/project/aws-creds-form';
import { AwsStepInstructions } from '../../../../components/project/aws-step-instructions';
import { Button } from '../../../../components/ui/button';
import { Input, Field } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add an AWS connection';

export default function NewAwsConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<AwsMode>('assume_role');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [defaultRegion, setDefaultRegion] = useState('us-east-1');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const canSave = !!name.trim() && !!defaultRegion && (mode === 'assume_role' ? !!roleArn.trim() : !!accessKeyId.trim() && !!secretAccessKey.trim());

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/aws/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          defaultRegion,
          ...(mode === 'access_key' ? { accessKeyId: accessKeyId.trim(), secretAccessKey } : { roleArn: roleArn.trim() }),
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/aws');
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
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the AWS integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/aws')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production account" onChange={(e) => setName(e.target.value)} />
            </Field>
            <AwsCredsForm
              mode={mode}
              onModeChange={setMode}
              accessKeyId={accessKeyId}
              onAccessKeyIdChange={setAccessKeyId}
              secretAccessKey={secretAccessKey}
              onSecretAccessKeyChange={setSecretAccessKey}
              roleArn={roleArn}
              onRoleArnChange={setRoleArn}
              defaultRegion={defaultRegion}
              onDefaultRegionChange={setDefaultRegion}
            />
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/aws')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Reusable read-only credentials. Grant an IAM role or access key read permissions across
            the AWS accounts you want assistants to query, then connect it once here — projects pick
            this connection and scope it to specific AWS accounts.
          </p>
          <AwsStepInstructions />
        </div>
      </div>
    </WorkspaceShell>
  );
}
