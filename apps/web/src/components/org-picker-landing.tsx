'use client';

import { useEffect, useState } from 'react';
import { api, type Org } from '../lib/api';
import { orgHostUrl } from '../lib/org';
import { AppShell } from './app-shell';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { EmptyState } from './ui/empty-state';
import { PageHeader } from './ui/page-header';
import { Skeleton } from './ui/skeleton';

// Workspaces are founded via the marketing signup (each org gets its own
// Keycloak realm there) — the app only lists and opens them.
const SIGNUP_URL = 'https://beecause.ai/signup';

export function OrgPickerLanding() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    api<Org[]>('/api/orgs')
      .then(setOrgs)
      .catch((e) => setListError(e instanceof Error ? e.message : 'Failed to load workspaces'));
  }, []);

  const listSection = () => {
    if (listError) {
      return <p className="text-sm text-crit">{listError}</p>;
    }
    if (orgs === null) {
      return <Skeleton rows={3} />;
    }
    if (orgs.length === 0) {
      return (
        <EmptyState
          mark
          title="Create your first workspace"
          body="A workspace is where your team's projects and assistants live."
        />
      );
    }
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((o) => (
          <a key={o.id} href={orgHostUrl(o.slug)} className="block no-underline">
            <Card className="cursor-pointer">
              <span className="text-lg font-medium">{o.name}</span>
              <span className="font-mono text-xs text-fg-faint">{o.slug}</span>
            </Card>
          </a>
        ))}
      </div>
    );
  };

  return (
    <AppShell org={null}>
      <PageHeader title="Workspaces" />

      {listSection()}

      <section className="mt-10">
        <a href={SIGNUP_URL} className="no-underline">
          <Button type="button">Create a new workspace</Button>
        </a>
      </section>
    </AppShell>
  );
}
