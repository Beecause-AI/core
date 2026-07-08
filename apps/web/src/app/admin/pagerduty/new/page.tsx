'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type PagerDutyRegion, type OrgInfo } from '../../../../lib/api';
import { Button } from '../../../../components/ui/button';
import { Input, Field, Select } from '../../../../components/ui/input';
import { Card } from '../../../../components/ui/card';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';

const TITLE = 'Add a PagerDuty connection';

export default function NewPagerDutyConnectionPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const [name, setName] = useState('');
  const [region, setRegion] = useState<PagerDutyRegion>('us');
  const [apiToken, setApiToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => { setOrg(o); if (o.myOrgRole === 'user') setUnauthorized(true); })
      .catch(() => setUnauthorized(true))
      .finally(() => setLoading(false));
  }, []);

  const canSave = !!name.trim() && !!apiToken.trim();

  async function save() {
    setFormError('');
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/pagerduty/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          region,
          apiToken,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(e.error ?? 'Failed to add connection');
        return;
      }
      router.push('/admin/pagerduty');
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
        <EmptyState title="Not authorized" body="Only org owners and managers can manage the PagerDuty integration." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title={TITLE} actions={<Button variant="ghost" onClick={() => router.push('/admin/pagerduty')}>Back</Button>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={name} placeholder="Production" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Region">
              <Select value={region} onChange={(e) => setRegion(e.target.value as PagerDutyRegion)}>
                <option value="us">US</option>
                <option value="eu">EU</option>
              </Select>
            </Field>
            <Field label="REST API key">
              <Input
                type="password"
                value={apiToken}
                placeholder="••••••••••••••••••••"
                onChange={(e) => setApiToken(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Add connection'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => router.push('/admin/pagerduty')}>Cancel</Button>
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Reusable read-only credentials. Create a General Access REST API key in your PagerDuty account
            (read-only scope), then connect it once here — projects pick this connection and scope it to
            specific services and teams.
          </p>
          <p className="text-sm text-fg-faint">
            To create a REST API key: go to <strong>Integrations → API Access Keys</strong> in PagerDuty,
            create a new key, and paste it above.{' '}
            <a
              href="https://support.pagerduty.com/docs/api-access-keys"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              PagerDuty API key docs ↗
            </a>
          </p>
        </div>
      </div>
    </WorkspaceShell>
  );
}
