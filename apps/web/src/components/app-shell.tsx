'use client';

import type { ReactNode } from 'react';
import { Avatar } from './ui/avatar';
import { Logo } from './ui/logo';
import { UserMenu } from './ui/user-menu';
import { ProjectSwitcher } from './ui/project-switcher';
import type { OrgInfo } from '../lib/api';

export function AppShell({
  org,
  children,
}: {
  org: OrgInfo | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 xl:max-w-7xl 2xl:max-w-[96rem]">
          {/* left: brand + org switcher */}
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Beecause home">
              <Logo variant="full" />
            </a>
            {org !== null && (
              <>
                <span className="text-fg-faint">/</span>
                {/* Sessions are realm-per-org, so the org is fixed — plain
                 * identity, not a switcher. */}
                <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                  <Avatar label={org.name} className="size-6" />
                  {org.name}
                </span>
                {/* project switcher: only renders when a project is active */}
                <ProjectSwitcher />
              </>
            )}
          </div>

          {/* right: account menu (Profile, API keys, Sign out) */}
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 xl:max-w-7xl 2xl:max-w-[96rem]">{children}</main>
    </div>
  );
}
