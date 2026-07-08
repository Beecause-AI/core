// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OrgInfo } from '../src/lib/api';

// WorkspaceShell (via AppShell) reads usePathname; jsdom has no Next router provider.
let mockPath = '/';
vi.mock('next/navigation', () => ({ usePathname: () => mockPath }));

import { WorkspaceShell } from '../src/components/workspace-shell';

const org = { id: 'o1', name: 'Acme', slug: 'acme', myOrgRole: 'owner' } as OrgInfo;

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function overviewLink(): HTMLAnchorElement | undefined {
  return screen.getAllByRole('link').find((a) => a.textContent === 'Overview' && a.getAttribute('href') === '/') as HTMLAnchorElement | undefined;
}

describe('WorkspaceShell Overview link', () => {
  test('renders an Overview link to / and marks it active on the home path', () => {
    mockPath = '/';
    render(<WorkspaceShell org={org}><div /></WorkspaceShell>);
    const link = overviewLink();
    expect(link).toBeDefined();
    expect(link!.getAttribute('aria-current')).toBe('page');
  });

  test('Overview link is present but inactive inside a project', () => {
    mockPath = '/p/acme/integrations';
    render(
      <WorkspaceShell org={org} projectNav={{ slug: 'acme', name: 'Acme', activeTab: 'integrations', isAdmin: true }}>
        <div />
      </WorkspaceShell>,
    );
    const link = overviewLink();
    expect(link).toBeDefined();
    expect(link!.getAttribute('aria-current')).toBeNull();
  });
});
