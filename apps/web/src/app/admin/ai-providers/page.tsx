'use client';

import { useEffect, useState } from 'react';
import { api, type ModelKey, type OrgInfo } from '../../../lib/api';
import { AI_PROVIDERS, providerStatus } from '../../../lib/ai-providers';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { ProviderMark } from '../../../components/ui/provider-mark';

export default function AiProvidersPage() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [keys, setKeys] = useState<ModelKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    // Provider keys are org-level (owner/manager only). Load org first so a
    // non-admin who lands here directly sees a clean "not authorized" state
    // instead of a broken page when the keys API 403s.
    Promise.all([api<OrgInfo>('/api/org'), api<ModelKey[]>('/api/model-keys')])
      .then(([o, ks]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setKeys(ks);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load AI providers');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <WorkspaceShell org={org}><PageHeader title="AI Providers" /><Skeleton rows={4} /></WorkspaceShell>;
  }

  if (unauthorized) {
    return (
      <WorkspaceShell org={org}><PageHeader title="AI Providers" />
        <EmptyState title="Not authorized" body="Only org owners and managers can manage AI providers." />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="AI Providers" />
      {error && <p className="mb-4 text-sm text-crit">{error}</p>}
      <p className="mb-6 max-w-xl text-sm text-fg-muted">
        Connect your own provider keys. Keys are stored encrypted, validated on save, and never shown again.
      </p>

      <div className="flex flex-col gap-3">
        {AI_PROVIDERS.map((p) => {
          const status = providerStatus(keys.find((k) => k.provider === p.id));
          return (
            <a key={p.id} href={p.href} className="block no-underline">
              <Card className="transition hover:border-accent">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderMark provider={p.id} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-lg font-medium">{p.label}</span>
                      <span className="text-sm text-fg-muted">{p.blurb}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Badge status={status.status}>{status.label}</Badge>
                  </div>
                </div>
              </Card>
            </a>
          );
        })}
      </div>
    </WorkspaceShell>
  );
}
