'use client';

import { useEffect, useState } from 'react';
import { api, fetchBilling, startCheckout, openBillingPortal, startCreditCheckout, fetchCreditLedger, type OrgInfo, type OrgBillingInfo, type CreditLedgerRow } from '../../lib/api';
import { PageHeader } from '../ui/page-header';
import { WorkspaceShell } from '../workspace-shell';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

/** Org-admin Billing page. Fetch /api/org + /api/org/billing + ledger in parallel; render plan, usage, credits. */
export function BillingSettings() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [billing, setBilling] = useState<OrgBillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Credits state
  const [ledger, setLedger] = useState<CreditLedgerRow[]>([]);
  const [topupPending, setTopupPending] = useState(false);
  const [topupError, setTopupError] = useState('');

  // Checkout / portal state
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    Promise.all([
      api<OrgInfo>('/api/org'),
      fetchBilling(),
      fetchCreditLedger().catch(() => ({ entries: [] })),
    ])
      .then(([o, b, l]) => {
        setOrg(o);
        setBilling(b);
        setLedger(l.entries);
      })
      .catch((e: { message?: string }) => setError(e?.message ?? 'Failed to load billing'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Billing" />
        <Skeleton rows={3} />
      </WorkspaceShell>
    );
  }

  if (error) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Billing" />
        <p className="text-sm text-crit">{error}</p>
      </WorkspaceShell>
    );
  }

  const isAdmin = org?.myOrgRole === 'owner' || org?.myOrgRole === 'manager';

  if (!isAdmin) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Billing" />
        <EmptyState
          title="Admins only"
          body="Only org owners and managers can manage billing."
        />
      </WorkspaceShell>
    );
  }

  const b = billing!;
  const isSelfServe = b.band === 'startup' || b.band === 'scaleup';

  async function handleSubscribe() {
    if (!isSelfServe) return;
    setActionError('');
    setActionPending(true);
    try {
      await startCheckout(b.band as 'startup' | 'scaleup');
    } catch (e) {
      const apiErr = e as { message?: string };
      setActionError(apiErr?.message ?? 'Failed to start checkout');
    } finally {
      setActionPending(false);
    }
  }

  async function handlePortal() {
    setActionError('');
    setActionPending(true);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (e) {
      const apiErr = e as { message?: string };
      setActionError(apiErr?.message ?? 'Failed to open billing portal');
      setActionPending(false);
    }
  }

  async function handleTopUp(amountCents: number) {
    setTopupError('');
    setTopupPending(true);
    try {
      const { url } = await startCreditCheckout(amountCents);
      window.location.href = url;
    } catch (e) {
      setTopupError((e as { message?: string })?.message ?? 'Failed to start checkout');
      setTopupPending(false);
    }
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Billing" />

      <div className="flex flex-col gap-6">
        {/* Card 1: Your plan */}
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-fg">{b.bandLabel}</span>
                {b.subscriptionStatus && (
                  <Badge status={b.subscriptionStatus === 'active' ? 'ok' : b.subscriptionStatus === 'past_due' ? 'warn' : 'neutral'}>
                    {b.subscriptionStatus}
                  </Badge>
                )}
              </div>
              <span className="text-sm text-fg-muted">
                {b.custom
                  ? 'Custom — talk to us'
                  : b.priceUsd != null
                    ? `$${b.priceUsd}/mo`
                    : 'Free'}
              </span>
              <span className="text-sm text-fg-muted">Unlimited seats</span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {b.billingEnabled ? (
                <Button variant="secondary" disabled={actionPending} onClick={() => void handlePortal()}>
                  Manage subscription
                </Button>
              ) : isSelfServe && !b.custom ? (
                b.stripeReady ? (
                  <Button variant="primary" disabled={actionPending} onClick={() => void handleSubscribe()}>
                    Subscribe
                  </Button>
                ) : (
                  <div className="flex flex-col items-end gap-1.5">
                    <Button variant="primary" disabled>
                      Subscribe
                    </Button>
                    <Badge status="neutral">Billing not yet enabled</Badge>
                  </div>
                )
              ) : null}
            </div>
          </div>
          {actionError && <p className="text-sm text-crit">{actionError}</p>}
        </Card>

        {/* Card 2: AI usage this month */}
        <Card>
          <span className="text-sm font-semibold uppercase tracking-wide text-fg-faint">AI usage this month</span>
          <p className="text-3xl font-bold text-fg">${b.usage.billableCostUsd.toFixed(2)}</p>
          <p className="text-sm text-fg-muted">
            {b.usage.invocationCount} conversations · {b.usage.period}
          </p>
          <p className="text-sm text-fg-muted">
            You pay for the AI your conversations use, at cost — drawn from your prepaid credits.
          </p>
        </Card>

        {/* Card 3: AI credits */}
        <Card>
          <span className="text-sm font-semibold uppercase tracking-wide text-fg-faint">AI credits</span>
          <p className="text-3xl font-bold text-fg">€{(b.creditBalanceCents / 100).toFixed(2)}</p>
          <p className="text-sm text-fg-muted">Prepaid balance. Your conversations draw it down at cost; background analysis is on us.</p>
          <div className="flex flex-wrap items-center gap-2">
            {[2500, 10000, 50000].map((cents) => (
              <Button key={cents} variant="secondary" disabled={topupPending || !b.stripeReady} onClick={() => void handleTopUp(cents)}>
                Add €{cents / 100}
              </Button>
            ))}
          </div>
          {!b.stripeReady && <Badge status="neutral">Billing not yet enabled</Badge>}
          {topupError && <p className="text-sm text-crit">{topupError}</p>}
          {ledger.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-fg-muted">
              {ledger.slice(0, 5).map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span>{e.kind}</span>
                  <span className={e.amountCents < 0 ? 'text-fg-muted' : 'text-fg'}>{e.amountCents < 0 ? '' : '+'}€{(e.amountCents / 100).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </WorkspaceShell>
  );
}
