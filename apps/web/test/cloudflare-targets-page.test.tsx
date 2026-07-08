// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { CloudflareConnection, CloudflareSignalReport } from '../src/lib/api';

// The page resolves its connection + scope via the mocked api():
//   GET  ${base}/connection            → the bound connection (or null)
//   GET  ${base}/connections           → the choosable connections
//   GET  ${base}/targets               → the scope's allowed resources
//   POST ${base}/connection/verify     → the per-signal verify report
let mockConnection: CloudflareConnection | null = null;
let mockConnections: CloudflareConnection[] = [];
let mockVerify: { report: CloudflareSignalReport; availableSignals: string[] } = {
  report: { analytics: { ok: true }, logs: { ok: true }, workers: { ok: true } },
  availableSignals: ['analytics', 'logs', 'workers'],
};

vi.mock('../src/lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.endsWith('/connection/verify')) return Promise.resolve(mockVerify);
    if (path.endsWith('/connection')) return Promise.resolve({ connection: mockConnection });
    if (path.endsWith('/connections')) return Promise.resolve({ connections: mockConnections });
    if (path.endsWith('/targets')) return Promise.resolve({ targets: [] });
    return Promise.resolve({ result: [] });
  }),
}));

import { api } from '../src/lib/api';
import { CloudflareTargetsPage } from '../src/components/project/cloudflare-targets-page';

const conn: CloudflareConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'CF prod', mode: 'api_token', enabled: true,
  metadata: { accountId: 'acct123' },
  lastTestedAt: null, lastTestOk: null, createdAt: '',
};

beforeEach(() => {
  vi.mocked(api).mockClear();
  mockConnection = conn;
  mockConnections = [conn];
  mockVerify = {
    report: { analytics: { ok: true }, logs: { ok: true }, workers: { ok: true } },
    availableSignals: ['analytics', 'logs', 'workers'],
  };
});

afterEach(() => cleanup());

describe('CloudflareTargetsPage — persistent signal pills', () => {
  it('renders section pills from the persisted last-check result without clicking Verify', async () => {
    mockConnection = {
      ...conn,
      lastTestedAt: '2026-06-15T00:00:00.000Z',
      lastTestOk: true,
      metadata: { ...conn.metadata, availableSignals: ['analytics', 'logs'] },
    };
    mockConnections = [mockConnection];
    render(<CloudflareTargetsPage slug="beecause" />);
    await screen.findByText('CF prod');

    // Section labels are present on initial render — no Verify click.
    expect(screen.getByText('Analytics')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Workers')).toBeDefined();
  });
});

describe('CloudflareTargetsPage — verify bound connection', () => {
  it('shows a Verify button and refreshes the per-signal pills + last-checked line', async () => {
    render(<CloudflareTargetsPage slug="beecause" />);
    await screen.findByText('CF prod');

    const verifyBtn = screen.getByRole('button', { name: /^Verify$/ });
    expect(verifyBtn).toBeDefined();
    fireEvent.click(verifyBtn);

    // Section pills remain rendered (now driven by the fresh verify report).
    expect(await screen.findByText('Analytics')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Workers')).toBeDefined();

    // Persisted last-checked line updates to OK.
    await waitFor(() => expect(screen.getByText(/Checked .* · OK/)).toBeDefined());

    expect(api).toHaveBeenCalledWith(
      '/api/org/projects/beecause/cloudflare/connection/verify',
      { method: 'POST' },
    );
  });
});
