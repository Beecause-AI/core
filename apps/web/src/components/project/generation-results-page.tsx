'use client';

import { useEffect, useState } from 'react';
import { fetchLatestProposal, type TeamProposal } from '../../lib/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { CostForecast } from './cost-forecast';

/**
 * Dedicated generation-results page at /p/{slug}/assistants/generation.
 * Shows the persisted LAST generation (rationale, gaps, the proposed/applied team) — survives
 * after the team is applied — plus the cost estimate (relocated off the main Assistants page).
 */
export function GenerationResultsPage({ slug }: { slug: string }) {
  const listHref = `/p/${slug}/assistants`;
  const [proposal, setProposal] = useState<TeamProposal | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    fetchLatestProposal(slug)
      .then((p) => setProposal(p))
      .catch(() => setProposal(null));
  }, [slug]);

  if (proposal === undefined) return <Skeleton rows={5} />;

  const doc = proposal?.proposal ?? null;
  // Only surface gaps meant to be raised to the operator (mirrors the proposal-review card).
  const raisedGaps = doc?.gaps.filter((g) => g.audience === 'raise') ?? [];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-fg">Last generation</h2>
          <p className="text-sm text-fg-muted">
            The most recent AI team design — rationale, gaps, the team, and the cost estimate.
          </p>
        </div>
        <Button variant="secondary" onClick={() => { window.location.href = listHref; }}>
          Back to assistants
        </Button>
      </div>

      {!doc ? (
        <EmptyState
          title="No generation yet"
          body="Generate a team from the Assistants page to see the design report here."
          action={<Button onClick={() => { window.location.href = listHref; }}>Go to assistants</Button>}
        />
      ) : (
        <>
          {/* Rationale */}
          {doc.rationale && (
            <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-5">
              <h3 className="text-sm font-semibold text-fg">Rationale</h3>
              <p className="whitespace-pre-wrap text-sm text-fg-muted">{doc.rationale}</p>
            </div>
          )}

          {/* Team */}
          <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5">
            <h3 className="text-sm font-semibold text-fg">Team</h3>
            <div className="flex flex-col gap-2">
              {doc.assistants.map((a) => (
                <div key={a.key} className="rounded-md border border-edge bg-raised p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">{a.name}</span>
                    <Badge status={a.isLead ? 'info' : 'neutral'}>
                      {a.isLead ? 'orchestrator' : 'specialist'}
                    </Badge>
                    <span className="ml-auto flex items-center gap-3">
                      <Badge status="neutral">{a.enabledTools.length} tools</Badge>
                      <span className="font-mono text-xs text-fg-faint">{a.model}</span>
                    </span>
                  </div>
                  {a.rationale && <p className="mt-1 text-xs text-fg-muted">{a.rationale}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Gaps */}
          {raisedGaps.length > 0 && (
            <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-5">
              <h3 className="text-sm font-semibold text-fg">Gaps</h3>
              {raisedGaps.map((g, i) => {
                const badgeStatus = g.severity === 'critical' ? 'crit' : g.severity === 'recommended' ? 'warn' : 'neutral';
                return (
                  <div
                    key={i}
                    className={
                      g.severity === 'critical'
                        ? 'rounded-md border border-crit/30 bg-crit/10 p-3'
                        : g.severity === 'recommended'
                          ? 'rounded-md border border-warn/30 bg-warn/10 p-3'
                          : 'rounded-md border border-edge bg-raised p-3'
                    }
                  >
                    <div className="flex items-center gap-2">
                      <Badge status={badgeStatus}>{g.severity}</Badge>
                      <span className="text-sm font-medium text-fg">{g.title}</span>
                      {g.integration && <span className="ml-auto font-mono text-xs text-fg-faint">{g.integration}</span>}
                    </div>
                    {g.detail && <p className="mt-1 text-xs text-fg-muted">{g.detail}</p>}
                    {g.integration && (
                      <a
                        className="mt-1 inline-block text-xs text-accent underline"
                        href={`/p/${slug}/integrations/${g.integration}`}
                      >
                        Set up {g.integration} →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cost estimate (relocated from the Assistants page) */}
          <CostForecast slug={slug} />
        </>
      )}
    </section>
  );
}
