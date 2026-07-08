'use client';

import { Suspense, useEffect, useState } from 'react';
import { api, type OrgInfo, type Project } from '../lib/api';
import { currentSlug } from '../lib/org';
import { WorkspaceShell } from '../components/workspace-shell';
import { NotFound404 } from '../components/not-found-404';
import { OrgPickerLanding } from '../components/org-picker-landing';
import { EmptyState } from '../components/ui/empty-state';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';

function OrgLanding() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OrgInfo>('/api/org')
      .then((o) => {
        setOrg(o);
        return api<Project[]>('/api/org/projects');
      })
      .then(setProjects)
      .catch((e) => {
        if (e?.status === 404 || e?.status === 401) {
          setDenied(true);
        } else {
          setError(e instanceof Error ? e.message : 'Something went wrong');
        }
      });
  }, []);

  const isAdmin = org ? org.myOrgRole !== 'user' : false;
  const single = !isAdmin && projects?.length === 1 ? projects[0]!.slug : null;

  // Single-project member → deep link once, from an effect (not render body)
  useEffect(() => {
    if (single) window.location.href = `/p/${single}`;
  }, [single]);

  if (denied) {
    // Full takeover, no AppShell: workspace chrome would imply a workspace
    // that doesn't exist (or that the user can't see — the API doesn't say which).
    return <NotFound404 variant="workspace" />;
  }

  if (error) {
    return (
      <WorkspaceShell org={null}>
        <p className="text-sm text-crit">{error}</p>
      </WorkspaceShell>
    );
  }

  if (!org || !projects || single) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Projects" />
        <Skeleton rows={3} variant="grid" />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader
        title="Projects"
        actions={
          isAdmin ? (
            <Button onClick={() => (window.location.href = '/project/new')}>
              New project
            </Button>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          mark
          title={isAdmin ? 'Create your first project' : 'No projects yet'}
          body={
            isAdmin
              ? 'Group your assistants and teammates into a project.'
              : 'Ask an org admin to add you to a project.'
          }
          action={
            isAdmin ? (
              <Button onClick={() => (window.location.href = '/project/new')}>
                New project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <a
              key={p.id}
              href={`/p/${p.slug}`}
              className="block no-underline"
            >
              <Card className="hover:-translate-y-0.5 transition">
                <span className="text-lg font-medium">{p.name}</span>
                <span className="font-mono text-xs text-fg-faint">{p.slug}</span>
              </Card>
            </a>
          ))}
        </div>
      )}
    </WorkspaceShell>
  );
}

function Inner() {
  // Guard window access for SSR (static export prerenders without a DOM).
  // During prerender, typeof window === 'undefined', so currentSlug() returns null.
  // OrgPickerLanding is also SSR-safe: its data fetches are in useEffect.
  const slug = typeof window !== 'undefined' ? currentSlug() : null;

  if (slug === null) {
    return <OrgPickerLanding />;
  }

  return <OrgLanding />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
