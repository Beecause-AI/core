// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

// KgSection (via kg-section.tsx) imports KgExplore which pulls react-force-graph-2d
vi.mock('react-force-graph-2d', () => ({ default: () => null }));

import { KgArchitecture } from '../src/components/project/knowledge-graph/kg-architecture';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AUTH_ID = 'comp-auth';
const PG_ID = 'ds-postgres';
const FLOW_ID = 'flow-login';
const FILE_ID = 'file-auth-ts';

const graphFixture = {
  nodes: [
    { id: AUTH_ID, kind: 'component', name: 'Auth', businessFlow: null, digest: 'Handles authentication', metadata: null, repoFullName: 'acme/api' },
    { id: PG_ID, kind: 'datastore', name: 'PostgreSQL', businessFlow: null, digest: 'User DB', metadata: null, repoFullName: 'acme/infra' },
    { id: FLOW_ID, kind: 'flow', name: 'Login Flow', businessFlow: 'User Authentication', digest: null, metadata: null, repoFullName: null },
  ],
  edges: [
    { src: FLOW_ID, dst: AUTH_ID, relation: 'touches' },
    { src: AUTH_ID, dst: PG_ID, relation: 'depends_on' },
  ],
};

// Outgoing fetch for component: composes/depends_on/emits (no touches)
const authChildrenOutgoing = {
  children: [
    { id: FILE_ID, kind: 'file', name: 'auth.ts', businessFlow: null, digest: null, metadata: { path: 'src/auth.ts' }, repoFullName: 'acme/api' },
    { id: PG_ID, kind: 'datastore', name: 'PostgreSQL', businessFlow: null, digest: 'User DB', metadata: null, repoFullName: 'acme/infra' },
  ],
};
// Incoming touches fetch for component: flows that touch this component
const authChildrenIncomingTouches = {
  children: [
    { id: FLOW_ID, kind: 'flow', name: 'Login Flow', businessFlow: 'User Authentication', digest: null, metadata: null, repoFullName: null },
  ],
};

const flowChildrenFixture = {
  children: [
    { id: FILE_ID, kind: 'file', name: 'auth.ts', businessFlow: null, digest: null, metadata: { path: 'src/auth.ts' }, repoFullName: 'acme/api' },
  ],
};

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/knowledge-graph/graph'))
      return new Response(JSON.stringify(graphFixture), { status: 200 });
    if (u.includes('/knowledge-graph/children') && u.includes(`node=${encodeURIComponent(AUTH_ID)}`)) {
      if (u.includes('dir=in'))
        return new Response(JSON.stringify(authChildrenIncomingTouches), { status: 200 });
      return new Response(JSON.stringify(authChildrenOutgoing), { status: 200 });
    }
    if (u.includes('/knowledge-graph/children') && u.includes(`node=${encodeURIComponent(FLOW_ID)}`))
      return new Response(JSON.stringify(flowChildrenFixture), { status: 200 });
    return new Response(JSON.stringify({ children: [] }), { status: 200 });
  }));
}

describe('KgArchitecture', () => {
  test('renders Architecture root with component and datastore cards', async () => {
    stubFetch();
    render(<KgArchitecture slug="acme" />);
    // Should show Auth component card
    await waitFor(() => expect(screen.getByText('Auth')).toBeDefined());
    // Should show PostgreSQL datastore card
    expect(screen.getByText('PostgreSQL')).toBeDefined();
    // Breadcrumb shows Architecture
    expect(screen.getByText('Architecture')).toBeDefined();
  });

  test('clicking a component fetches its children and shows them', async () => {
    stubFetch();
    render(<KgArchitecture slug="acme" />);
    await waitFor(() => expect(screen.getByText('Auth')).toBeDefined());
    // Click the Auth component card
    fireEvent.click(screen.getByText('Auth'));
    // Children: auth.ts file and Login Flow should appear
    await waitFor(() => expect(screen.getByText('auth.ts')).toBeDefined());
    expect(screen.getByText('Login Flow')).toBeDefined();
    // Breadcrumb now shows Architecture / Auth
    expect(screen.getByText('Architecture')).toBeDefined();
    expect(screen.getByText('Auth')).toBeDefined();
  });

  test('clicking a flow in component level shows flow children', async () => {
    stubFetch();
    render(<KgArchitecture slug="acme" />);
    await waitFor(() => expect(screen.getByText('Auth')).toBeDefined());
    fireEvent.click(screen.getByText('Auth'));
    await waitFor(() => expect(screen.getByText('Login Flow')).toBeDefined());
    // Click the flow
    fireEvent.click(screen.getByText('Login Flow'));
    // Flow children: auth.ts
    await waitFor(() => expect(screen.getByText('auth.ts')).toBeDefined());
    // Breadcrumb shows 3 levels
    expect(screen.getByText('Architecture')).toBeDefined();
    expect(screen.getByText('Auth')).toBeDefined();
    expect(screen.getByText('Login Flow')).toBeDefined();
  });

  test('clicking Architecture breadcrumb returns to root', async () => {
    stubFetch();
    render(<KgArchitecture slug="acme" />);
    await waitFor(() => expect(screen.getByText('Auth')).toBeDefined());
    fireEvent.click(screen.getByText('Auth'));
    await waitFor(() => expect(screen.getByText('auth.ts')).toBeDefined());
    // Click Architecture crumb to go back to root
    // At component level, 'Architecture' is a crumb link (button)
    const archCrumb = screen.getAllByText('Architecture').find((el) => el.tagName === 'BUTTON' || el.closest('button') || el.getAttribute('role') === 'button' || el.tagName === 'SPAN');
    fireEvent.click(archCrumb!);
    // Back to root: should show component cards again, not child files
    await waitFor(() => expect(screen.queryByText('auth.ts')).toBeNull());
    expect(screen.getByText('Auth')).toBeDefined();
  });

  test('shows error state when graph fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'server error' }), { status: 500 })));
    render(<KgArchitecture slug="acme" />);
    await waitFor(() => expect(screen.getByText(/server error/i)).toBeDefined());
  });
});
