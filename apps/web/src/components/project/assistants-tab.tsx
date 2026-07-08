'use client';

import { useEffect, useState } from 'react';
import { api, fetchSystemAgents, fetchTeamVersions, generateTeam, type Assistant, type ProjectRepo, type ProjectSlackChannels, type SystemAgentMeta, type TeamVersion } from '../../lib/api';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { TeamDesignSection } from './team-design-section';
import { TeamStructure, systemAgentsMap } from './team-structure';
import { TeamVersionSwitcher } from './team-version-switcher';

export function AssistantsTab({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const base = `/api/org/projects/${slug}/assistants`;
  const newHref = `/p/${slug}/assistants/new`;
  const [assistants, setAssistants] = useState<Assistant[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hasCodeSource, setHasCodeSource] = useState(false);
  const [systemAgents, setSystemAgents] = useState<SystemAgentMeta[]>([]);
  const [slackConnected, setSlackConnected] = useState(false);

  const [versions, setVersions] = useState<TeamVersion[]>([]);
  // Bumped after a redesign is triggered so TeamDesignSection re-fetches and shows the
  // generating/review card (it otherwise only loads its proposal on mount).
  const [genSignal, setGenSignal] = useState(0);

  const reload = () => api<Assistant[]>(base).then(setAssistants).catch(() => setAssistants([]));
  const reloadVersions = () => fetchTeamVersions(slug).then((r) => setVersions(r?.versions ?? [])).catch(() => setVersions([]));
  useEffect(() => { void reload(); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reloadVersions(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<ProjectRepo[]>(`/api/org/projects/${slug}/repos`)
      .then((repos) => { setHasCodeSource(repos.length > 0); })
      .catch(() => { setHasCodeSource(false); });
    fetchSystemAgents(slug).then(setSystemAgents).catch(() => setSystemAgents([]));
    // Slack is "connected for this project" when the workspace is connected AND at least one
    // channel in it is bound to this project.
    api<ProjectSlackChannels>(`/api/org/projects/${slug}/slack-channels`)
      .then((s) => { setSlackConnected(s.connected && s.assigned.length > 0); })
      .catch(() => { setSlackConnected(false); });
  }, [slug]);

  async function removeAssistant(a: Assistant) {
    if (!confirm(`Delete "${a.name}"? This cannot be undone.`)) return;
    setDeletingId(a.id);
    try { await api<void>(`${base}/${a.id}`, { method: 'DELETE' }); setAssistants((xs) => xs!.filter((x) => x.id !== a.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setDeletingId(null); }
  }

  const leads = (assistants ?? []).filter((a) => a.isLead);
  const orchestratorWarning =
    leads.length === 0
      ? 'No orchestrator yet — generate a team or flag one assistant as Orchestrator.'
      : leads.length > 1
        ? 'Multiple orchestrators — only one is expected per project.'
        : null;

  const hasTeam = !!assistants && assistants.length > 0;
  const reloadAll = () => { void reload(); void reloadVersions(); };

  // Redesign = kick off a fresh generation in place (idempotent server-side). The review
  // card then appears via TeamDesignSection; applying it creates the new version.
  async function redesign() {
    try { await generateTeam(slug); setGenSignal((n) => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to start generation'); }
  }

  const activeVersion = versions.find((v) => v.isActive) ?? null;
  const autogen = (assistants ?? []).filter((a) => a.sourceProposalId);
  const manual = (assistants ?? []).filter((a) => !a.sourceProposalId);
  // The live team diverges from the active snapshot when an autogen agent was edited, the
  // autogen-agent count no longer matches the version, or a manual agent coexists with it.
  const modified = !!activeVersion && (
    autogen.some((a) => a.userModified) ||
    autogen.length !== activeVersion.agentCount ||
    manual.length > 0
  );

  return (
    <section className="flex flex-col gap-6">
      {/* Empty project (no team) → the design hero is the headline CTA at the top.
          When a team exists → review-only mode: just the ready/generating cards. */}
      <TeamDesignSection
        slug={slug}
        isAdmin={isAdmin}
        hasCodeSource={hasCodeSource}
        onApplied={reloadAll}
        reviewOnly={hasTeam}
        reloadSignal={genSignal}
      />

      {hasTeam && orchestratorWarning && (
        <p className="rounded-md border border-warn/30 bg-warn/10 p-3 text-sm text-warn">{orchestratorWarning}</p>
      )}

      {hasTeam && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-fg">Team structure</h2>
            {isAdmin && (
              <TeamVersionSwitcher
                slug={slug}
                modified={modified}
                canRedesign={hasCodeSource}
                onActivated={reloadAll}
                onRedesign={() => void redesign()}
              />
            )}
          </div>
          <TeamStructure slug={slug} assistants={assistants!} systemAgents={systemAgentsMap(systemAgents)} slackConnected={slackConnected} />
        </div>
      )}

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">Assistants</h2>
          <div className="flex items-center gap-2">
            {assistants && assistants.length > 0 && (
              <Button variant="secondary" onClick={() => { window.location.href = `/p/${slug}/assistants/generation`; }}>
                View last generation
              </Button>
            )}
            {isAdmin && <Button onClick={() => { window.location.href = newHref; }}>New assistant</Button>}
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-crit">{error}</p>}

        {assistants === null ? <Skeleton rows={5} /> : assistants.length === 0 ? (
          <EmptyState
            title="No assistants yet"
            body={isAdmin ? 'Create an assistant to get started.' : 'No assistants have been created for this project.'}
            action={isAdmin ? <Button onClick={() => { window.location.href = newHref; }}>New assistant</Button> : undefined}
          />
        ) : (
          <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
            {assistants.map((a) => {
              const editHref = `/p/${slug}/assistants/${a.id}`;
              const body = (
                <>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-fg">{a.name}</span>
                    {a.persona && <span className="truncate text-xs text-fg-muted">{a.persona}</span>}
                  </div>
                  <span className="hidden shrink-0 font-mono text-xs text-fg-faint sm:inline">
                    {a.model}{a.provider ? ` · ${a.provider}` : ''}
                  </span>
                  <Badge status="neutral">{a.enabledTools.length} tools</Badge>
                </>
              );
              return (
                <div key={a.id} className="flex items-center">
                  {isAdmin ? (
                    // The whole row opens the editor; Delete lives outside the link.
                    <a href={editHref} className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3 no-underline transition-colors hover:bg-raised">
                      {body}
                    </a>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3">{body}</div>
                  )}
                  {isAdmin && (
                    <div className="shrink-0 pr-3">
                      <Button variant="danger" disabled={deletingId === a.id} onClick={() => removeAssistant(a)}>
                        {deletingId === a.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
