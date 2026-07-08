'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  fetchTeamProposal,
  generateTeam,
  applyTeamProposal,
  discardTeamProposal,
  type TeamProposal,
  type OrgInfo,
} from '../../lib/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { DebugPromptPreview } from './debug-prompt-preview';
import { GenerationProgress } from './generation-progress';

/** Faint AI/sparkle mark for the design hero — neutral container per the icon recipe. */
function HeroMark() {
  return (
    <div className="flex size-12 items-center justify-center rounded-card border border-edge-strong bg-raised text-fg-muted">
      <svg className="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l1.9 5.1L19 9.5l-5.1 1.9L12 16.5l-1.9-5L5 9.5l5.1-1.9z" />
        <path d="M18.5 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
      </svg>
    </div>
  );
}

/** "What to expect" — the three beats of the flow, shown in the empty-state hero so a
 *  newcomer understands what generation does and that it is safe/reversible. */
const HERO_STEPS = [
  { n: '1', title: 'We analyze', body: 'We read your connected repositories and integrations to understand how your system fits together.' },
  { n: '2', title: 'You get a draft', body: 'A complete proposed team — roles, models, tools, and who hands off to whom — with the reasoning behind each choice.' },
  { n: '3', title: 'You decide', body: 'Nothing is created until you apply. Regenerate or switch between saved versions whenever you like.' },
];

export function TeamDesignSection({
  slug,
  isAdmin,
  hasCodeSource,
  onApplied,
  reviewOnly = false,
  reloadSignal = 0,
}: {
  slug: string;
  isAdmin: boolean;
  hasCodeSource: boolean;
  onApplied: () => void;
  /** When a team already exists: only surface the ready/generating review cards, never the
   *  big empty-state hero or the connect-a-code-source gate (those belong to the no-team view). */
  reviewOnly?: boolean;
  /** Bumped by the parent after triggering a redesign so we re-fetch the (new) proposal. */
  reloadSignal?: number;
}) {
  const [proposal, setProposal] = useState<TeamProposal | null | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [debugEnabled, setDebugEnabled] = useState(false);
  const off = useRef(false);
  useEffect(() => () => { off.current = true; }, []);

  const load = useCallback(async () => {
    try {
      const p = await fetchTeamProposal(slug);
      if (!off.current) setProposal(p);
    } catch {
      if (!off.current) setProposal(null);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);
  // Re-fetch when the parent signals a redesign was triggered.
  useEffect(() => { if (reloadSignal > 0) void load(); }, [reloadSignal, load]);

  useEffect(() => { api<OrgInfo>('/api/org').then((o) => setDebugEnabled(o.debugEnabled)).catch(() => {}); }, []);

  // While generating, poll every 3s.
  const status = proposal?.status;
  useEffect(() => {
    if (status !== 'generating') return;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [status, load]);

  const start = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const p = await generateTeam(slug);
      setProposal(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start');
    } finally {
      setBusy(false);
    }
  }, [slug]);

  const apply = useCallback(async () => {
    if (!proposal) return;
    setBusy(true);
    setError('');
    try {
      await applyTeamProposal(slug, proposal.id);
      if (off.current) return;
      setProposal(null);
      onApplied();
    } catch (e) {
      if (!off.current) setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      if (!off.current) setBusy(false);
    }
  }, [slug, proposal, onApplied]);

  const discard = useCallback(async () => {
    if (!proposal) return;
    try {
      await discardTeamProposal(slug, proposal.id);
      if (!off.current) setProposal(null);
    } catch (e) {
      if (!off.current) setError(e instanceof Error ? e.message : 'Discard failed');
    }
  }, [slug, proposal]);

  // Still loading (undefined) or not an admin — render nothing
  if (proposal === undefined) return null;
  if (!isAdmin) return null;

  // Ready → review card
  if (proposal?.status === 'ready' && proposal.proposal) {
    const doc = proposal.proposal;
    const facts = proposal.facts;

    // Only surface gaps that are meant to be raised
    const raisedGaps = doc.gaps.filter((g) => g.audience === 'raise');

    // Facts summary line: live component names + signal-map products (deduped)
    const factsSummary = facts
      ? [
          facts.components.filter((c) => c.live).map((c) => c.name).join(', '),
          [...new Set(facts.signalMap.map((s) => s.product))].join(', '),
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

    return (
      <div className="flex flex-col gap-4 rounded-card border border-accent bg-surface p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-fg">Proposed team</h3>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void discard()}>
              Discard
            </Button>
            <Button disabled={busy} onClick={() => void apply()}>
              {busy ? 'Applying…' : 'Apply team'}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-crit">{error}</p>}

        {/* Facts summary */}
        {factsSummary && (
          <p className="text-xs text-fg-faint">Found: {factsSummary}</p>
        )}

        {doc.rationale && <p className="text-sm text-fg-muted">{doc.rationale}</p>}
        <div className="flex flex-col gap-2">
          {doc.assistants.map((a) => (
            <div key={a.key} className="rounded-md border border-edge bg-raised p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-fg">{a.name}</span>
                {a.isLead && <Badge status="info">orchestrator</Badge>}
                <span className="ml-auto font-mono text-xs text-fg-faint">{a.model}</span>
              </div>
              {a.rationale && <p className="mt-1 text-xs text-fg-muted">{a.rationale}</p>}
              {debugEnabled && (
                <div className="mt-2">
                  <DebugPromptPreview slug={slug} body={{ persona: a.persona, enabledTools: a.enabledTools, isLead: a.isLead }} />
                </div>
              )}
            </div>
          ))}
        </div>
        {raisedGaps.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-fg">Gaps</h4>
            {raisedGaps.map((g, i) => {
              const badgeStatus = g.severity === 'critical' ? 'crit' : g.severity === 'recommended' ? 'warn' : 'neutral';
              return (
                <div
                  key={i}
                  className={
                    g.severity === 'critical'
                      ? 'rounded-md border border-crit/30 bg-crit/10 p-3'
                      : 'rounded-md border border-warn/30 bg-warn/10 p-3'
                  }
                >
                  <div className="flex items-center gap-2">
                    <Badge status={badgeStatus}>{g.severity}</Badge>
                    <span className="text-sm font-medium text-fg">{g.title}</span>
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
      </div>
    );
  }

  // Generating → live phase progress (checklist + bar), polled by the 3s loop above.
  if (proposal?.status === 'generating') {
    return <GenerationProgress progress={proposal.progress} />;
  }

  // In review-only mode (a team already exists) the ready/generating cards above still render,
  // but the no-code-source gate and the empty/failed hero below are suppressed.
  if (reviewOnly) return null;

  // No code source → invite them to connect one first (explain why), with a real next step.
  if (!hasCodeSource) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-card border border-edge bg-surface px-6 py-10 text-center">
        <HeroMark />
        <div className="flex flex-col items-center gap-2">
          <h3 className="text-xl font-semibold tracking-tight text-fg">Design your team with AI</h3>
          <p className="max-w-xl text-sm text-fg-muted">
            First, connect your code. AI designs your team by reading your repositories — so once
            GitHub is connected and a repo is in scope, it can analyze your system and propose the
            right assistants for it.
          </p>
        </div>
        <Button onClick={() => { window.location.href = `/p/${slug}/integrations/github`; }}>
          Connect a code source
        </Button>
        <p className="max-w-xl text-sm text-fg-faint">Read-only access — we never write to your repositories.</p>
      </div>
    );
  }

  // Empty / failed → inviting, explanatory hero CTA.
  return (
    <div className="flex flex-col items-center gap-5 rounded-card border border-edge bg-surface px-6 py-10 text-center">
      <HeroMark />
      <div className="flex flex-col items-center gap-2">
        <h3 className="text-xl font-semibold tracking-tight text-fg">Design your team with AI</h3>
        <p className="max-w-xl text-sm text-fg-muted">
          New to this? Let AI do the heavy lifting. It looks at your project and proposes a
          ready-to-use team of assistants that already understand your system — and you stay in
          control the whole way.
        </p>
      </div>

      <div className="grid w-full gap-3 text-left sm:grid-cols-3">
        {HERO_STEPS.map((s) => (
          <div key={s.n} className="rounded-md border border-edge bg-raised p-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Step {s.n}</span>
            <h4 className="mt-1.5 text-sm font-medium text-fg">{s.title}</h4>
            <p className="mt-1 text-sm text-fg-muted">{s.body}</p>
          </div>
        ))}
      </div>

      <p className="max-w-xl text-sm text-fg-faint">
        Takes about a minute. You review the whole proposal before anything is created — this never
        touches your code or your live setup.
      </p>

      {proposal?.status === 'failed' && proposal.error && (
        <p className="text-sm text-crit">Last attempt failed: {proposal.error}</p>
      )}
      {error && <p className="text-sm text-crit">{error}</p>}

      <Button disabled={busy} onClick={() => void start()}>
        {busy ? 'Starting…' : proposal?.status === 'failed' ? 'Try again' : 'Design my team with AI'}
      </Button>
    </div>
  );
}
