'use client';

import { useEffect, useState } from 'react';
import { projectTabHref } from '../../lib/project-path';
import {
  api,
  fetchSystemAgents,
  type Assistant,
  type ProjectDetail,
  type ProjectSlackChannels,
  type SystemAgentMeta,
} from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { TeamDesignSection } from './team-design-section';
import { TeamStructure, systemAgentsMap } from './team-structure';

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <a href={href} className="block no-underline">
      <Card className="hover:-translate-y-0.5 transition">
        <span className="text-2xl font-semibold text-fg">{value}</span>
        <span className="text-sm text-fg-muted">{label}</span>
      </Card>
    </a>
  );
}

export function OverviewTab({ project, isAdmin }: { project: ProjectDetail; isAdmin: boolean }) {
  const [committed, setCommitted] = useState(project.description);
  const [description, setDescription] = useState(project.description);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setCommitted(project.description);
    setDescription(project.description);
  }, [project.description]);

  // No team yet → lead with the "Design your team with AI" hero (same component the
  // Assistants tab shows for an empty project). It self-gates on isAdmin and its own
  // proposal state; applying lands the user on the Assistants tab to see the new team.
  const hasTeam = project.counts.assistants > 0;

  // When a team exists, show the same read-only structure tree the Assistants tab renders.
  const [assistants, setAssistants] = useState<Assistant[] | null>(null);
  const [systemAgents, setSystemAgents] = useState<SystemAgentMeta[]>([]);
  const [slackConnected, setSlackConnected] = useState(false);
  useEffect(() => {
    if (!hasTeam) return;
    api<Assistant[]>(`/api/org/projects/${project.slug}/assistants`).then(setAssistants).catch(() => setAssistants([]));
    fetchSystemAgents(project.slug).then(setSystemAgents).catch(() => setSystemAgents([]));
    // Slack counts as connected for this project only when a channel is bound to it.
    api<ProjectSlackChannels>(`/api/org/projects/${project.slug}/slack-channels`)
      .then((s) => setSlackConnected(s.connected && s.assigned.length > 0))
      .catch(() => setSlackConnected(false));
  }, [hasTeam, project.slug]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api<ProjectDetail>(`/api/org/projects/${project.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      });
      setCommitted(description);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {!hasTeam && (
        <TeamDesignSection
          slug={project.slug}
          isAdmin={isAdmin}
          hasCodeSource={project.counts.repos > 0}
          onApplied={() => { window.location.href = projectTabHref(project.slug, 'assistants'); }}
        />
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">About</h2>
          {isAdmin && !editing && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {editing ? (
          <div className="flex max-w-xl flex-col gap-2">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this project scope?"
            />
            {error && <p className="text-sm text-crit">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDescription(committed);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="max-w-xl text-sm text-fg-muted">{committed || 'No description yet.'}</p>
        )}
      </section>

      {hasTeam && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Team structure</h2>
            <a href={projectTabHref(project.slug, 'assistants')} className="text-sm text-accent no-underline hover:underline">
              Manage team →
            </a>
          </div>
          {assistants === null ? (
            <Skeleton rows={4} />
          ) : (
            <TeamStructure
              slug={project.slug}
              assistants={assistants}
              systemAgents={systemAgentsMap(systemAgents)}
              slackConnected={slackConnected}
            />
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-fg">Scope</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="repositories"
            value={project.counts.repos}
            href={projectTabHref(project.slug, 'integrations')}
          />
          <StatCard
            label="assistants"
            value={project.counts.assistants}
            href={projectTabHref(project.slug, 'assistants')}
          />
          <StatCard
            label="members"
            value={project.counts.members}
            href={projectTabHref(project.slug, 'members')}
          />
        </div>
      </section>
    </div>
  );
}
