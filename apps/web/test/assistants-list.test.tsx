// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AssistantsTab } from '../src/components/project/assistants-tab';
import type { Assistant } from '../src/lib/api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const assistants: Assistant[] = [
  { id: 'a1', name: 'Researcher', persona: 'Finds things', model: 'claude-opus-4-8', provider: 'anthropic', enabledTools: ['agent.x', 'mcp.y'], isLead: false },
];

function stub(list: Assistant[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })));
}

describe('AssistantsTab (list view)', () => {
  test('renders assistants as list rows with model·provider and tool count', async () => {
    stub(assistants);
    render(<AssistantsTab slug="acme" isAdmin />);
    // 'Researcher' appears in both the Team-structure tree and the list; scope to the list row.
    await waitFor(() => expect(screen.getAllByText('Researcher').length).toBeGreaterThan(0));
    expect(screen.getByText(/claude-opus-4-8 · anthropic/)).toBeDefined();
    expect(screen.getByText('2 tools')).toBeDefined();
    expect(screen.getByRole('button', { name: /New assistant/ })).toBeDefined();
    // No Edit button — the whole row links to the editor.
    expect(screen.queryByRole('button', { name: /^Edit$/ })).toBeNull();
    // Both the tree and the list link to the editor; assert at least one points at the row.
    const rows = screen.getAllByRole('link', { name: /Researcher/ });
    expect(rows.some((r) => r.getAttribute('href') === '/p/acme/assistants/a1')).toBe(true);
  });

  test('shows the empty state when there are no assistants', async () => {
    stub([]);
    render(<AssistantsTab slug="acme" isAdmin />);
    await waitFor(() => expect(screen.getByText('No assistants yet')).toBeDefined());
  });
});
