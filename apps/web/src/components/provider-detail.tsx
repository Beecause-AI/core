'use client';

import { useEffect, useState } from 'react';
import { api, type ModelKey, type OrgInfo } from '../lib/api';
import { getAiProvider, providerStatus } from '../lib/ai-providers';
import { Button } from './ui/button';
import { Field, Input } from './ui/input';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { WorkspaceShell } from './workspace-shell';
import { PageHeader } from './ui/page-header';
import { Skeleton } from './ui/skeleton';
import { EmptyState } from './ui/empty-state';
import { ProviderMark } from './ui/provider-mark';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(seconds) >= secs) return rtf.format(-Math.round(seconds / secs), unit);
  }
  return rtf.format(-seconds, 'second');
}

function BackLink() {
  return (
    <a href="/admin/ai-providers" className="mb-4 inline-block text-sm text-fg-muted transition-colors hover:text-fg">
      ← AI Providers
    </a>
  );
}

/**
 * The full per-provider experience: API-key form when not configured, a
 * management panel when configured. Logic is scoped to a single provider id,
 * lifted verbatim from the old all-in-one AI Providers page.
 */
export function ProviderDetail({ providerId }: { providerId: string }) {
  const provider = getAiProvider(providerId);

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [stored, setStored] = useState<ModelKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);

  // Per-provider form/management state.
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [replacing, setReplacing] = useState(false); // configured providers reveal the form on demand
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  useEffect(() => {
    if (!provider) { setLoading(false); return; }
    // Provider keys are org-level (owner/manager only). Load org first so a
    // non-admin who lands here directly sees a clean "not authorized" state
    // instead of a broken page when the keys API 403s.
    Promise.all([api<OrgInfo>('/api/org'), api<ModelKey[]>('/api/model-keys')])
      .then(([o, ks]) => {
        setOrg(o);
        if (o.myOrgRole === 'user') { setUnauthorized(true); return; }
        setStored(ks.find((k) => k.provider === providerId) ?? null);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) setUnauthorized(true);
        else setError(e?.message ?? 'Failed to load AI provider');
      })
      .finally(() => setLoading(false));
  }, [provider, providerId]);

  function resetForm() {
    setKey(''); setBaseUrl(''); setReplacing(false); setBusy(false); setFormError(''); setTestResult(null);
  }

  async function save() {
    if (!provider) return;
    setBusy(true); setFormError(''); setTestResult(null);
    const body: { key: string; baseUrl?: string } = { key: key.trim() };
    if (provider.needsBaseUrl) body.baseUrl = baseUrl.trim();
    // PUT is fetched directly (not via api()) so we can surface the server's
    // `detail` on a 400 rejection — ApiError only carries the top-level error.
    try {
      const res = await fetch(`/api/model-keys/${provider.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const eb = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        const msg = [eb.error ?? 'Failed to save key', eb.detail].filter(Boolean).join(': ');
        setBusy(false); setFormError(msg);
        return;
      }
      const row = (await res.json()) as ModelKey;
      setStored(row);
      resetForm(); // clear the secret from local state on success — never keep it around
    } catch {
      setBusy(false); setFormError('Failed to save key');
    }
  }

  async function test() {
    if (!provider) return;
    setBusy(true); setFormError(''); setTestResult(null);
    try {
      const r = await api<{ ok: boolean; detail?: string }>(`/api/model-keys/${provider.id}/test`, { method: 'POST' });
      setBusy(false); setTestResult(r);
      setStored((k) => (k ? { ...k, lastTestOk: r.ok, lastTestedAt: new Date().toISOString() } : k));
    } catch (err) {
      const e = err as { message?: string };
      setBusy(false); setFormError(e?.message ?? 'Test failed');
    }
  }

  async function toggle(enabled: boolean) {
    if (!provider) return;
    setBusy(true); setFormError('');
    try {
      await api(`/api/model-keys/${provider.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      setStored((k) => (k ? { ...k, enabled } : k));
      setBusy(false);
    } catch (err) {
      const e = err as { message?: string };
      setBusy(false); setFormError(e?.message ?? 'Failed to update key');
    }
  }

  async function remove() {
    if (!provider) return;
    if (!window.confirm(`Remove your ${provider.label} key? Models from this provider will stop using it.`)) return;
    setBusy(true); setFormError('');
    try {
      await api(`/api/model-keys/${provider.id}`, { method: 'DELETE' });
      setStored(null);
      resetForm();
    } catch (err) {
      const e = err as { message?: string };
      setBusy(false); setFormError(e?.message ?? 'Failed to remove key');
    }
  }

  const title = provider?.label ?? 'AI Provider';

  if (!provider) {
    return (
      <WorkspaceShell org={org}>
        <BackLink />
        <PageHeader title="AI Provider" />
        <EmptyState title="Unknown provider" body="This provider doesn’t exist. Pick one from the AI Providers list." />
      </WorkspaceShell>
    );
  }

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <BackLink />
        <PageHeader title={title} />
        <Skeleton rows={3} />
      </WorkspaceShell>
    );
  }

  if (unauthorized) {
    return (
      <WorkspaceShell org={org}>
        <BackLink />
        <PageHeader title={title} />
        <EmptyState title="Not authorized" body="Only org owners and managers can manage AI providers." />
      </WorkspaceShell>
    );
  }

  if (error) {
    return (
      <WorkspaceShell org={org}>
        <BackLink />
        <PageHeader title={title} />
        <p className="text-sm text-crit">{error}</p>
      </WorkspaceShell>
    );
  }

  const showForm = !stored || replacing;
  const status = providerStatus(stored ?? undefined);

  return (
    <WorkspaceShell org={org}>
      <BackLink />
      <PageHeader title={title} />
      <p className="mb-6 max-w-xl text-sm text-fg-muted">{provider.blurb}</p>

      <Card className="max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ProviderMark provider={provider.id} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-lg font-medium">{provider.label}</span>
              {stored ? (
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-fg-faint">{stored.keyHint}</span>
                  {stored.baseUrl && <span className="font-mono text-xs text-fg-faint">{stored.baseUrl}</span>}
                </span>
              ) : (
                <span className="text-sm text-fg-muted">{provider.blurb}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge status={status.status}>{status.label}</Badge>
            {stored?.lastTestOk === true && stored.lastTestedAt && (
              <span className="text-xs text-fg-faint">· verified {relativeTime(stored.lastTestedAt)}</span>
            )}
          </div>
        </div>

        {showForm ? (
          <form
            className="mt-4 flex max-w-md flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            {provider.needsBaseUrl && (
              <Field label="Base URL">
                <Input
                  type="url"
                  autoComplete="off"
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setFormError(''); }}
                  required
                  placeholder="https://api.example.com/v1"
                />
              </Field>
            )}
            <Field label="API key">
              <Input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => { setKey(e.target.value); setFormError(''); }}
                required
                placeholder={provider.placeholder}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>{busy ? 'Testing…' : 'Save & test'}</Button>
              {stored && replacing && (
                <Button type="button" variant="ghost" disabled={busy} onClick={resetForm}>Cancel</Button>
              )}
            </div>
            {formError && <p className="text-sm text-crit">{formError}</p>}
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void toggle(!stored!.enabled)}>
              {stored!.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void test()}>Test</Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => { setReplacing(true); setKey(''); setBaseUrl(stored!.baseUrl ?? ''); setFormError(''); setTestResult(null); }}
            >
              Replace
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>Remove</Button>
            {testResult && (
              <span className={testResult.ok ? 'text-sm text-ok' : 'text-sm text-crit'}>
                {testResult.ok ? '✓ Key valid' : `✗ ${testResult.detail ?? 'Key rejected'}`}
              </span>
            )}
            {formError && <p className="w-full text-sm text-crit">{formError}</p>}
          </div>
        )}
      </Card>
    </WorkspaceShell>
  );
}
