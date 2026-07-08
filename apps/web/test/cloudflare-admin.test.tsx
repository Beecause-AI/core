// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CloudflarePage from '../src/app/admin/cloudflare/page';
import type { CloudflareConnection, CloudflareSignalReport } from '../src/lib/api';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/cloudflare', useRouter: () => ({ push: pushMock }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); pushMock.mockClear(); });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const DEFAULT_VERIFY_REPORT: CloudflareSignalReport = {
  analytics: { ok: true }, logs: { ok: true }, workers: { ok: false, error: 'no worker scripts found' },
};

const conn: CloudflareConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'Prod CF',
  mode: 'api_token', enabled: true,
  metadata: { accountId: 'acct-123' },
  lastTestedAt: null, lastTestOk: null, createdAt: '2026-06-01T00:00:00.000Z',
};

function stubFetch(opts: { connections?: CloudflareConnection[]; myOrgRole?: string; post?: Handler; verify?: Handler } = {}) {
  const { connections = [], myOrgRole = 'owner', post, verify } = opts;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (method === 'POST' && /\/connections\/[^/]+\/verify$/.test(url)) {
      return verify ? verify(url, init) : new Response(JSON.stringify({ report: DEFAULT_VERIFY_REPORT, availableSignals: ['analytics', 'logs'] }), { status: 200 });
    }
    if (method === 'POST' && url.includes('/api/integrations/cloudflare/connections')) {
      return post ? post(url, init) : new Response(JSON.stringify({ connection: conn }), { status: 200 });
    }
    if (url.includes('/api/integrations/cloudflare/connections')) {
      return new Response(JSON.stringify({ connections }), { status: 200 });
    }
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

describe('CloudflarePage — list', () => {
  test('renders connection name, mode + status and the account ID', async () => {
    stubFetch({ connections: [conn] });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText('Prod CF')).toBeDefined());
    expect(screen.getByText('API Token')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('acct-123')).toBeDefined();
  });

  test('empty state offers an Add connection CTA', async () => {
    stubFetch({ connections: [] });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText(/Connect Cloudflare/)).toBeDefined());
    expect(screen.getAllByRole('button', { name: /Add connection/i }).length).toBeGreaterThan(0);
  });
});

describe('CloudflarePage — add connection', () => {
  test('Add connection navigates to the dedicated add-connection page', async () => {
    stubFetch({ connections: [] });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText(/Connect Cloudflare/)).toBeDefined());
    fireEvent.click(screen.getAllByRole('button', { name: /Add connection/i })[0]!);
    expect(pushMock).toHaveBeenCalledWith('/admin/cloudflare/new');
  });
});

describe('CloudflarePage — signal pills', () => {
  test('renders persistent section pills from the connection metadata without Verify', async () => {
    const checked: CloudflareConnection = {
      ...conn,
      lastTestedAt: '2026-06-15T00:00:00.000Z',
      lastTestOk: true,
      metadata: { ...conn.metadata, availableSignals: ['analytics', 'logs'] },
    };
    stubFetch({ connections: [checked] });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText('Prod CF')).toBeDefined());
    expect(screen.getByText('Analytics')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Workers')).toBeDefined();
  });
});

describe('CloudflarePage — verify', () => {
  test('Verify refreshes the section pills and a last-checked line', async () => {
    stubFetch({ connections: [conn] });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText('Prod CF')).toBeDefined());
    // No check has happened yet, so no last-checked line.
    expect(screen.queryByText(/^Checked /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText('Analytics')).toBeDefined());
    expect(screen.getByText('Workers')).toBeDefined();
    // analytics/logs are ok → anyOk → "· OK"
    await waitFor(() => expect(screen.getByText(/^Checked .* · OK$/)).toBeDefined());
  });

  test('Verify surfaces an inline error when the endpoint fails', async () => {
    stubFetch({
      connections: [conn],
      verify: async () => new Response(JSON.stringify({ error: 'invalid token' }), { status: 400 }),
    });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText('Prod CF')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText(/invalid token/)).toBeDefined());
  });
});

describe('CloudflarePage — authorization', () => {
  test('plain users are not authorized', async () => {
    stubFetch({ connections: [], myOrgRole: 'user' });
    render(<CloudflarePage />);
    await waitFor(() => expect(screen.getByText(/Not authorized/)).toBeDefined());
  });
});
