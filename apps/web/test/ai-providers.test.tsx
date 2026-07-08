// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AiProvidersPage from '../src/app/admin/ai-providers/page';
import type { ModelKey } from '../src/lib/api';

// WorkspaceShell reads usePathname; jsdom has no Next router provider.
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/ai-providers' }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubFetch(opts: { keys?: ModelKey[]; myOrgRole?: string }) {
  const { keys = [], myOrgRole = 'owner' } = opts;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/model-keys')) return new Response(JSON.stringify(keys), { status: 200 });
    if (url.includes('/api/org/projects')) return new Response('[]', { status: 200 });
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

const validAnthropic: ModelKey = {
  provider: 'anthropic', keyHint: '…abcd', enabled: true, baseUrl: null,
  lastTestedAt: '2026-06-01T00:00:00.000Z', lastTestOk: true,
};

describe('AiProvidersPage (hub)', () => {
  test('lists all four provider cards, each linking to its detail page', async () => {
    stubFetch({ keys: [] });
    render(<AiProvidersPage />);
    await waitFor(() => expect(screen.getByText('Anthropic (Claude)')).toBeDefined());

    expect(screen.getByText('Anthropic (Claude)').closest('a')?.getAttribute('href')).toBe('/admin/ai-providers/anthropic');
    expect(screen.getByText('OpenAI').closest('a')?.getAttribute('href')).toBe('/admin/ai-providers/openai');
    expect(screen.getByText('Google (Gemini)').closest('a')?.getAttribute('href')).toBe('/admin/ai-providers/google');
    expect(screen.getByText('Custom (OpenAI-compatible)').closest('a')?.getAttribute('href')).toBe('/admin/ai-providers/openai-compatible');
  });

  test('renders no API-key forms on the hub', async () => {
    stubFetch({ keys: [validAnthropic] });
    const { container } = render(<AiProvidersPage />);
    await waitFor(() => expect(screen.getByText('Anthropic (Claude)')).toBeDefined());
    expect(container.querySelector('input')).toBeNull();
  });

  test('derives the status badge from the matching ModelKey', async () => {
    stubFetch({
      keys: [
        validAnthropic, // enabled + ok → Connected
        { provider: 'openai', keyHint: '…1', enabled: false, baseUrl: null, lastTestedAt: null, lastTestOk: true }, // Disabled
        { provider: 'google', keyHint: '…2', enabled: true, baseUrl: null, lastTestedAt: null, lastTestOk: false }, // Rejected
        // openai-compatible: no key → Not configured
      ],
    });
    render(<AiProvidersPage />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeDefined());
    expect(screen.getByText('Disabled')).toBeDefined();
    expect(screen.getByText('Rejected')).toBeDefined();
    expect(screen.getByText('Not configured')).toBeDefined();
  });

  test('shows the not-authorized state for non-admins (myOrgRole: user)', async () => {
    stubFetch({ keys: [validAnthropic], myOrgRole: 'user' });
    render(<AiProvidersPage />);
    await waitFor(() => expect(screen.getByText('Not authorized')).toBeDefined());
    expect(screen.getByText(/Only org owners and managers can manage AI providers/i)).toBeDefined();
    expect(screen.queryByText('Anthropic (Claude)')).toBeNull();
  });
});
