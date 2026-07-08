// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

// KgExplore pulls in react-force-graph-2d (touches window/canvas) — stub it out.
vi.mock('react-force-graph-2d', () => ({ default: () => null }));

import { KnowledgeGraphSection } from '../src/components/project/knowledge-graph/kg-section';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/**
 * Stub fetch so that:
 *   GET .../knowledge-graph  → { build, flows }
 *   GET .../repos            → repos array
 *   POST .../build           → { accepted: true, buildId: 'b1' }
 *   GET .../graph            → { nodes: [], edges: [] }
 *   GET .../children         → { children: [] }
 */
function stub(
  kg: { build: unknown; flows: unknown[] },
  repos: unknown[] = [{ repoFullName: 'acme/web' }],
) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/knowledge-graph') && (!init || init.method !== 'POST'))
      return new Response(JSON.stringify(kg), { status: 200 });
    if (u.endsWith('/repos'))
      return new Response(JSON.stringify(repos), { status: 200 });
    if (u.endsWith('/knowledge-graph/build'))
      return new Response(JSON.stringify({ accepted: true, buildId: 'b1' }), { status: 202 });
    if (u.includes('/knowledge-graph/graph'))
      return new Response(JSON.stringify({ nodes: [], edges: [] }), { status: 200 });
    if (u.includes('/knowledge-graph/children'))
      return new Response(JSON.stringify({ children: [] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
}

describe('KnowledgeGraphSection', () => {
  test('renders the gate when no repos are scoped', async () => {
    stub({ build: null, flows: [] }, []);
    render(<KnowledgeGraphSection slug="acme" isAdmin />);
    await waitFor(() => expect(screen.getByText('Connect GitHub')).toBeDefined());
  });

  test('renders the empty hero for an admin when there is no build', async () => {
    stub({ build: null, flows: [] });
    render(<KnowledgeGraphSection slug="acme" isAdmin />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build knowledge graph' })).toBeDefined());
  });

  test('renders the building state while a build is running', async () => {
    stub({
      build: { status: 'running', phase: 'structure', nodesAnalyzed: 0, tokens: 0, note: null, finishedAt: null },
      flows: [],
    });
    render(<KnowledgeGraphSection slug="acme" isAdmin />);
    await waitFor(() => expect(screen.getByText('Building knowledge graph…')).toBeDefined());
  });

  test('renders Architecture view + Explore graph toggle when the build is done', async () => {
    stub({
      build: { status: 'done', phase: 'finalize', nodesAnalyzed: 3, tokens: 1000, note: null, finishedAt: '2026-01-01T00:00:00Z' },
      flows: [],
    });
    render(<KnowledgeGraphSection slug="acme" isAdmin />);
    // Architecture is the default view — the view toggle buttons should be visible
    await waitFor(() => expect(screen.getByRole('button', { name: 'Architecture' })).toBeDefined());
    expect(screen.getByRole('button', { name: 'Explore graph' })).toBeDefined();
    // Rebuild affordance visible for admin
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeDefined();
  });

  test('shows non-admin message when there is no build and user is not admin', async () => {
    stub({ build: null, flows: [] });
    render(<KnowledgeGraphSection slug="acme" isAdmin={false} />);
    await waitFor(() => expect(screen.getByText(/An admin can build it/)).toBeDefined());
  });
});
