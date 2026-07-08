'use client';

import { useState, type ReactNode } from 'react';
import { Breadcrumb } from '../ui/breadcrumb';
import { WritePolicySection } from './write-policy-section';
import { projectTabHref } from '../../lib/project-path';
import { cn } from '../ui/cn';

type Tab = 'scope' | 'policy';

/** One integration's page at the project level: a Scope tab (manage repos/channels)
 *  and an Approval policy tab (per-operation approval policy).
 *  Pass readOnly to hide the tablist and always render only the scope children
 *  (e.g. for read-only integrations like Cloudflare that have no mutating tools). */
export function IntegrationDetail({ slug, provider, providerLabel, scopeLabel, isAdmin, readOnly = false, children }: {
  slug: string;
  provider: string;
  providerLabel: string;
  scopeLabel: string;
  isAdmin: boolean;
  readOnly?: boolean;
  children: ReactNode; // the scope editor (repos / channels)
}) {
  const [tab, setTab] = useState<Tab>('scope');
  const tabs: [Tab, string][] = [['scope', scopeLabel], ['policy', 'Approval policy']];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb items={[{ label: 'Integrations', href: projectTabHref(slug, 'integrations') }, { label: providerLabel }]} />
      {!readOnly && (
        <nav role="tablist" className="flex gap-6 border-b border-edge">
          {tabs.map(([k, label]) => (
            <button
              key={k} type="button" role="tab" aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn('-mb-px border-b-2 px-0.5 pb-3 text-sm', tab === k ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {readOnly || tab === 'scope' ? children : <WritePolicySection slug={slug} provider={provider} providerLabel={providerLabel} isAdmin={isAdmin} />}
    </div>
  );
}
