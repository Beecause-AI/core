'use client';

import { type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell } from './app-shell';
import { cn } from './ui/cn';
import { type OrgInfo } from '../lib/api';
import { PROJECT_TABS, projectTabHref, type ProjectTab } from '../lib/project-path';

/** When rendered inside a project, the left rail shows that project's pages. */
export type ProjectNav = { slug: string; name: string; activeTab: ProjectTab; isAdmin: boolean };

const PAGE_LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
  integrations: 'Integrations',
  'knowledge-graph': 'Knowledge Graph',
  assistants: 'Assistants',
  memory: 'Memory',
  skills: 'Skills',
  conversations: 'Conversations',
  members: 'Members',
  settings: 'Settings',
};

type NavItem = { href: string; title: string; active: boolean; mono?: boolean; strong?: boolean };

function NavLink({ item }: { item: NavItem }) {
  return (
    <a
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      className={cn(
        'truncate rounded-md px-2.5 py-1.5 text-sm transition-colors',
        item.active
          ? 'bg-raised font-medium text-fg'
          : item.strong
            ? 'font-medium text-fg hover:bg-raised'
            : 'text-fg-muted hover:bg-raised hover:text-fg',
      )}
    >
      {item.title}
    </a>
  );
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">
        {label}
      </span>
      {items.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}
    </div>
  );
}

/**
 * Default chrome of the logged-in app: AppShell header + the workspace left
 * menu. Everyone gets the Projects section; owners/managers also get the Admin
 * section. New org-scoped areas append a section here.
 */
export function WorkspaceShell({ org, projectNav, children }: { org: OrgInfo | null; projectNav?: ProjectNav; children: ReactNode }) {
  const pathname = usePathname();
  const isOrgAdmin = org?.myOrgRole === 'owner' || org?.myOrgRole === 'manager';

  // Project pages fill the rail when inside a project; the project itself is
  // switched from the top bar, so the rail no longer lists projects.
  const pages = projectNav
    ? PROJECT_TABS.filter((t) => (t !== 'settings' || projectNav.isAdmin) && (t !== 'memory' || projectNav.isAdmin) && (t !== 'skills' || projectNav.isAdmin) && (t !== 'knowledge-graph' || !!org?.kgEnabled))
    : [];

  return (
    <AppShell org={org}>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <aside className="shrink-0 md:w-44">
          <nav className="flex flex-col gap-5 md:sticky md:top-20">
            <div className="flex flex-col gap-1">
              <NavLink item={{ href: '/', title: 'Overview', active: pathname === '/' }} />
            </div>
            {projectNav && (
              <div className="flex flex-col gap-1 border-t border-edge pt-5">
                {/* The project's overview page, labelled with the project name, is the parent. */}
                <NavLink
                  item={{ href: projectTabHref(projectNav.slug, 'overview'), title: projectNav.name, active: projectNav.activeTab === 'overview', strong: true }}
                />
                <div className="flex flex-col gap-1 pl-3">
                  {pages.filter((t) => t !== 'overview').map((t) => (
                    <NavLink
                      key={t}
                      item={{ href: projectTabHref(projectNav.slug, t), title: PAGE_LABELS[t], active: projectNav.activeTab === t }}
                    />
                  ))}
                </div>
              </div>
            )}
            {isOrgAdmin && (
              // Org-level admin: the last group in the rail, separated from project pages.
              <div className="border-t border-edge pt-5">
                <NavSection
                  label="Admin"
                  items={[
                    { href: '/admin/members', title: 'Members', active: pathname === '/admin/members' },
                    { href: '/admin/integrations', title: 'Integrations', active: pathname.startsWith('/admin/integrations') || pathname === '/admin/github' },
                    { href: '/admin/features', title: 'Features', active: pathname === '/admin/features' },
                    { href: '/admin/billing', title: 'Billing', active: pathname === '/admin/billing' },
                  ]}
                />
              </div>
            )}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </AppShell>
  );
}
