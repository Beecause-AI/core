// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import GcpPage from '../src/app/admin/gcp/page';
import type { GcpConnection, GcpSignalReport } from '../src/lib/api';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/gcp', useRouter: () => ({ push: pushMock }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); pushMock.mockClear(); });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const DEFAULT_VERIFY_REPORT: GcpSignalReport = {
  monitoring: { ok: true }, logging: { ok: true }, trace: { ok: false, error: 'missing trace.spans.list' },
};
// The real server contract: POST .../verify returns { report, availableSignals }.
const DEFAULT_VERIFY_RESPONSE = {
  report: DEFAULT_VERIFY_REPORT,
  availableSignals: Object.entries(DEFAULT_VERIFY_REPORT)
    .filter(([, v]) => v?.ok)
    .map(([k]) => k),
};

const conn: GcpConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'Prod SA',
  mode: 'sa_key', enabled: true,
  metadata: { saEmail: 'ro@acme-prod.iam', defaultGcpProjectId: 'acme-prod' },
  lastTestedAt: '2026-06-01T00:00:00.000Z', lastTestOk: true, createdAt: '2026-06-01T00:00:00.000Z',
};

function stubFetch(opts: { connections?: GcpConnection[]; myOrgRole?: string; post?: Handler; verify?: Handler } = {}) {
  const { connections = [], myOrgRole = 'owner', post, verify } = opts;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (method === 'POST' && /\/connections\/[^/]+\/verify$/.test(url)) {
      return verify ? verify(url, init) : new Response(JSON.stringify(DEFAULT_VERIFY_RESPONSE), { status: 200 });
    }
    if (method === 'POST' && url.includes('/api/integrations/gcp/connections')) {
      return post ? post(url, init) : new Response(JSON.stringify({ connection: conn }), { status: 200 });
    }
    if (url.includes('/api/integrations/gcp/connections')) {
      return new Response(JSON.stringify({ connections }), { status: 200 });
    }
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}


describe('GcpPage — list', () => {
  test('renders connection name, mode + status and the default project ID', async () => {
    stubFetch({ connections: [conn] });
    render(<GcpPage />);
    await waitFor(() => expect(screen.getByText('Prod SA')).toBeDefined());
    expect(screen.getByText('Service account key')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('acme-prod')).toBeDefined();
  });

  test('empty state offers an Add connection CTA', async () => {
    stubFetch({ connections: [] });
    render(<GcpPage />);
    await waitFor(() => expect(screen.getByText(/Connect Google Cloud/)).toBeDefined());
    expect(screen.getAllByRole('button', { name: /Add connection/i }).length).toBeGreaterThan(0);
  });
});

describe('GcpPage — add connection', () => {
  test('Add connection navigates to the dedicated add-connection page', async () => {
    stubFetch({ connections: [] });
    render(<GcpPage />);
    await waitFor(() => expect(screen.getByText(/Connect Google Cloud/)).toBeDefined());
    fireEvent.click(screen.getAllByRole('button', { name: /Add connection/i })[0]!);
    expect(pushMock).toHaveBeenCalledWith('/admin/gcp/new');
  });
});

describe('GcpPage — signal pills', () => {
  test('renders persistent section pills from the connection metadata without Verify', async () => {
    const checked: GcpConnection = {
      ...conn,
      lastTestedAt: '2026-06-15T00:00:00.000Z',
      lastTestOk: true,
      metadata: { ...conn.metadata, availableSignals: ['monitoring', 'logging'] },
    };
    stubFetch({ connections: [checked] });
    render(<GcpPage />);
    await waitFor(() => expect(screen.getByText('Prod SA')).toBeDefined());
    // Section labels are present on initial render — no Verify click.
    expect(screen.getByText('Metrics')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Traces')).toBeDefined();
  });

  test('Verify refreshes the section pills and a last-checked line', async () => {
    // Start with a connection that was never checked so the line only appears after Verify.
    const fresh: GcpConnection = { ...conn, lastTestedAt: null, lastTestOk: null, metadata: { ...conn.metadata, availableSignals: undefined } };
    stubFetch({ connections: [fresh] });
    render(<GcpPage />);
    await waitFor(() => expect(screen.getByText('Prod SA')).toBeDefined());
    expect(screen.queryByText(/^Checked /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    // Verify opens the report modal; section labels now appear in both the pills
    // and the modal, so assert at least one of each is present.
    await waitFor(() => expect(screen.getByText(/verification report/i)).toBeDefined());
    expect(screen.getAllByText('Metrics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Traces').length).toBeGreaterThan(0);
    // monitoring/logging are ok → anyOk → "· OK"
    await waitFor(() => expect(screen.getByText(/^Checked .* · OK$/)).toBeDefined());
  });
});

describe('GcpPage — authorization', () => {
  test('plain users are not authorized', async () => {
    stubFetch({ connections: [], myOrgRole: 'user' });
    render(<GcpPage />);
    await waitFor(() => expect(screen.getByText(/Not authorized/)).toBeDefined());
  });
});
