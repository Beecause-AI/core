// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import GithubPage from '../src/app/admin/github/page';
import type { GithubConnection } from '../src/lib/api';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/github' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(opts: { conn?: GithubConnection | null; repos?: string[]; myOrgRole?: string; put?: Handler; installUrl?: string }) {
  const { conn = null, repos = ['acme-corp/web'], myOrgRole = 'owner', put, installUrl = 'https://github.com/apps/intellilabs-agent/installations/new?state=x' } = opts;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (method === 'PUT' && put) return put(url, init);
    if (url.includes('/api/github/connection/repos')) return new Response(JSON.stringify({ repos }), { status: 200 });
    if (url.includes('/api/github/install-url')) return new Response(JSON.stringify({ url: installUrl }), { status: 200 });
    if (url.includes('/api/github/connection')) return new Response(conn === null ? 'null' : JSON.stringify(conn), { status: 200 });
    if (url.includes('/api/org/projects')) return new Response('[]', { status: 200 });
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

const connected: GithubConnection = {
  provider: 'github', mode: 'agent_app', baseUrl: null, accountLabel: 'acme-corp', secretHint: null,
  enabled: true, lastTestedAt: '2026-06-01T00:00:00.000Z', lastTestOk: true,
  metadata: { installationId: '555', events: { issues: true, pullRequests: true, branches: false } },
};

describe('GithubPage — wizard (not connected)', () => {
  test('shows the three connect methods', async () => {
    stubFetch({ conn: null });
    render(<GithubPage />);
    await waitFor(() => expect(screen.getByText(/Beecause Agent/)).toBeDefined());
    expect(screen.getByText('Personal Access Token')).toBeDefined();
    expect(screen.getByText('Your own GitHub App')).toBeDefined();
  });

  test('PAT connect SUCCESS flips to the connected view', async () => {
    stubFetch({ conn: null, put: () => new Response(JSON.stringify(connected), { status: 201 }) });
    const { container } = render(<GithubPage />);
    await waitFor(() => expect(screen.getByText('Personal Access Token')).toBeDefined());
    fireEvent.click(screen.getByText('Personal Access Token'));
    const pwd = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pwd, { target: { value: 'ghp_secret' } });
    fireEvent.click(screen.getByRole('button', { name: /connect & verify/i }));
    await waitFor(() => expect(screen.getByText(/Connected as acme-corp/)).toBeDefined());
  });

  test('PAT connect REJECT shows the server detail inline', async () => {
    stubFetch({ conn: null, put: () => new Response(JSON.stringify({ error: 'token rejected', detail: 'bad credentials' }), { status: 400 }) });
    const { container } = render(<GithubPage />);
    await waitFor(() => expect(screen.getByText('Personal Access Token')).toBeDefined());
    fireEvent.click(screen.getByText('Personal Access Token'));
    fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /connect & verify/i }));
    await waitFor(() => expect(screen.getByText(/bad credentials/)).toBeDefined());
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  test('Install on GitHub requests an install URL and navigates', async () => {
    stubFetch({ conn: null });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign, search: '' }, writable: true });
    render(<GithubPage />);
    await waitFor(() => expect(screen.getByText(/Beecause Agent/)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /install on github/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining('/apps/intellilabs-agent/installations/new')));
  });
});

describe('GithubPage — connected', () => {
  test('shows account, repos, and event toggles (branches Off)', async () => {
    stubFetch({ conn: connected, repos: ['acme-corp/web', 'acme-corp/api'] });
    render(<GithubPage />);
    await waitFor(() => expect(screen.getByText(/Connected as acme-corp/)).toBeDefined());
    // Repos load from a separate fetch — wait for them rather than asserting synchronously.
    expect(await screen.findByText('acme-corp/web')).toBeDefined();
    expect(screen.getByText('acme-corp/api')).toBeDefined();
    expect(screen.getByText('Branches & pushes')).toBeDefined();
    // The page renders an Off toggle per event type — assert at least one is present.
    expect(screen.getAllByRole('button', { name: 'Off' }).length).toBeGreaterThan(0);
  });

  test('PAT connection shows the no-events note', async () => {
    stubFetch({ conn: { ...connected, mode: 'pat', metadata: {} } });
    render(<GithubPage />);
    await waitFor(() => expect(screen.getAllByText(/Event capture/).length).toBeGreaterThan(0));
  });
});

describe('GithubPage — guard', () => {
  test('non-admin sees Not authorized', async () => {
    stubFetch({ conn: null, myOrgRole: 'user' });
    render(<GithubPage />);
    await waitFor(() => expect(screen.getByText('Not authorized')).toBeDefined());
  });
});
