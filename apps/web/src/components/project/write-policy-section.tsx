'use client';

import { useEffect, useState } from 'react';
import { fetchIntegrationTools, fetchApprovalPolicy, saveApprovalPolicy, type ApprovalPolicy, type IntegrationTool } from '../../lib/api';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../ui/cn';

const opTitle = (name: string) => {
  const op = name.split('.').slice(2).join('_');
  return op ? op.charAt(0).toUpperCase() + op.slice(1).replace(/_/g, ' ') : name;
};

/** Per-operation write-approval policy for one integration. Each write operation has its
 *  own require-approval toggle, stored as a project policy override keyed by tool name.
 *  The org policy (when set) takes precedence and locks the controls. */
export function WritePolicySection({ slug, provider, providerLabel, isAdmin }: {
  slug: string; provider: string; providerLabel: string; isAdmin: boolean;
}) {
  const [writeTools, setWriteTools] = useState<IntegrationTool[] | null>(null);
  const [policy, setPolicy] = useState<ApprovalPolicy | null>(null);
  const [orgManaged, setOrgManaged] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([fetchIntegrationTools(slug), fetchApprovalPolicy(slug)])
      .then(([tools, ap]) => {
        setWriteTools(tools.filter((t) => t.mutates && t.name.startsWith(`integration.${provider}.`)));
        setPolicy(ap.policy);
        setOrgManaged(ap.orgManaged);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoaded(true));
  }, [slug, provider]);

  if (!loaded) return <Skeleton rows={3} />;
  if (error) return <p className="text-sm text-crit">{error}</p>;
  if (!writeTools || writeTools.length === 0) {
    return <p className="text-sm text-fg-faint">{providerLabel} has no write operations.</p>;
  }

  const effective = (name: string) => policy?.overrides?.[name] ?? policy?.writeToolsRequireApproval ?? false;
  const locked = orgManaged || !isAdmin;

  async function setOne(name: string, next: boolean) {
    if (locked) return;
    setSaving(name); setError('');
    const overrides = { ...(policy?.overrides ?? {}), [name]: next };
    const np: ApprovalPolicy = { writeToolsRequireApproval: policy?.writeToolsRequireApproval ?? false, overrides };
    try { await saveApprovalPolicy(slug, np); setPolicy(np); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        Choose which {providerLabel} write operations need a human to approve before the assistant runs them.
      </p>
      {orgManaged && (
        <p className="rounded-md border border-edge bg-raised px-3 py-2 text-sm text-fg-muted">
          Your organization has set an approval policy. It applies to every project and takes precedence over these settings.
        </p>
      )}
      <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
        {writeTools.map((t) => (
          <div key={t.name} className={cn('flex items-center justify-between gap-4 px-4 py-3', locked && 'opacity-60')}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-fg">{opTitle(t.name)}</span>
              {t.description && <span className="text-sm text-fg-faint">{t.description}</span>}
              <span className="truncate font-mono text-xs text-fg-faint">{t.name}</span>
            </div>
            <label className={cn('flex shrink-0 items-center gap-2 text-sm text-fg-muted', locked ? 'cursor-default' : 'cursor-pointer')}>
              <input type="checkbox" checked={effective(t.name)} disabled={locked || saving === t.name} onChange={(e) => setOne(t.name, e.target.checked)} />
              Require approval
            </label>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-crit">{error}</p>}
    </div>
  );
}
