'use client';

import { useEffect, useState } from 'react';
import { api, updateOrgSettings, type OrgInfo } from '../../lib/api';
import { PageHeader } from '../ui/page-header';
import { WorkspaceShell } from '../workspace-shell';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { cn } from '../ui/cn';

/** A single feature toggle row: label + description on the left, checkbox on the right. */
function FeatureRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-6 px-5 py-4',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{title}</span>
        <span className="text-sm text-fg-muted">{description}</span>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0 accent-accent"
      />
    </label>
  );
}

/** Org-admin Features page. Fetch /api/org; render feature toggles. */
export function FeatureSettings() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hindsightEnabled, setHindsightEnabled] = useState(false);
  const [showCostUsd, setShowCostUsd] = useState(false);
  const [reportsEnabled, setReportsEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => {
        setOrg(o);
        setHindsightEnabled(o.hindsightEnabled);
        setShowCostUsd(o.showCostUsd);
        setReportsEnabled(o.reportsEnabled);
      })
      .catch((e: { message?: string }) => setError(e?.message ?? 'Failed to load org'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Features" />
        <Skeleton rows={2} />
      </WorkspaceShell>
    );
  }

  if (error) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Features" />
        <p className="text-sm text-crit">{error}</p>
      </WorkspaceShell>
    );
  }

  const isAdmin = org?.myOrgRole === 'owner' || org?.myOrgRole === 'manager';

  if (!isAdmin) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Features" />
        <EmptyState
          title="Admins only"
          body="Only org owners and managers can manage feature settings."
        />
      </WorkspaceShell>
    );
  }

  async function toggleHindsight(next: boolean) {
    setSaveError('');
    const prev = hindsightEnabled;
    setHindsightEnabled(next); // optimistic
    setSaving(true);
    try {
      await updateOrgSettings({ hindsightEnabled: next });
    } catch (e) {
      setHindsightEnabled(prev); // revert
      const apiErr = e as { message?: string };
      setSaveError(apiErr?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleShowCostUsd(next: boolean) {
    setSaveError('');
    const prev = showCostUsd;
    setShowCostUsd(next); // optimistic
    setSaving(true);
    try {
      await updateOrgSettings({ showCostUsd: next });
    } catch (e) {
      setShowCostUsd(prev); // revert
      const apiErr = e as { message?: string };
      setSaveError(apiErr?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleReports(next: boolean) {
    setSaveError('');
    const prev = reportsEnabled;
    setReportsEnabled(next); // optimistic
    setSaving(true);
    try {
      await updateOrgSettings({ reportsEnabled: next });
    } catch (e) {
      setReportsEnabled(prev); // revert
      const apiErr = e as { message?: string };
      setSaveError(apiErr?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Features" />

      <div className="flex flex-col gap-6">
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          <FeatureRow
            title="Incident memory"
            description="Keeps a rolling summary of each conversation and indexes it so assistants can search related past incidents (the `recent.search` tool). Incurs summarization cost."
            checked={hindsightEnabled}
            disabled={saving}
            onChange={(next) => void toggleHindsight(next)}
          />
          <FeatureRow
            title="Show dollar costs"
            description="Display estimated $ costs alongside token counts in cost forecasts."
            checked={showCostUsd}
            disabled={saving}
            onChange={(next) => void toggleShowCostUsd(next)}
          />
          <FeatureRow
            title="Investigation reports"
            description="Let assistants offer a shareable HTML incident report in Slack (premium, cost-incurring)."
            checked={reportsEnabled}
            disabled={saving}
            onChange={(next) => void toggleReports(next)}
          />
        </div>
        {saveError && <p className="text-sm text-crit">{saveError}</p>}
      </div>
    </WorkspaceShell>
  );
}
