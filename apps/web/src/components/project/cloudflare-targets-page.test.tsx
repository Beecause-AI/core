import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { CloudflareConnection, CloudflareTarget } from '../../lib/api';

// The page resolves its connection + scope via the mocked api():
//   GET ${base}/connection  → the bound connection (or null)
//   GET ${base}/connections → the choosable connections
//   GET ${base}/targets     → the scope's allowed resources (empty = unrestricted)
let mockConnection: CloudflareConnection | null = null;
let mockConnections: CloudflareConnection[] = [];
let mockTargets: CloudflareTarget[] = [];

vi.mock('../../lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.endsWith('/connection')) return Promise.resolve({ connection: mockConnection });
    if (path.endsWith('/connections')) return Promise.resolve({ connections: mockConnections });
    if (path.endsWith('/targets')) return Promise.resolve({ targets: mockTargets });
    return Promise.resolve({ result: [] });
  }),
}));

import { api } from '../../lib/api';
import { CloudflareTargetsPage } from './cloudflare-targets-page';

const conn: CloudflareConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'CF prod', mode: 'api_token', enabled: true,
  metadata: { accountId: 'a-known' }, lastTestedAt: null, lastTestOk: null, createdAt: '',
};

beforeEach(() => {
  vi.mocked(api).mockClear();
  mockConnection = conn;
  mockConnections = [conn];
  mockTargets = [];
});

afterEach(() => cleanup());

describe('CloudflareTargetsPage — bound connection, unrestricted scope', () => {
  it('shows the bound connection and an unrestricted "All resources" scope', async () => {
    render(<CloudflareTargetsPage slug="beecause" />);

    // bound connection name + account id (faint)
    expect(await screen.findByText('CF prod')).toBeDefined();
    expect(screen.getByText('a-known')).toBeDefined();

    // Scope defaults to All resources with the unrestricted blurb.
    expect(
      screen.getByText(/can query any zone or account this connection can access/i),
    ).toBeDefined();
  });

  it('reveals the add-resource form when restricting to specific resources', async () => {
    render(<CloudflareTargetsPage slug="beecause" />);
    await screen.findByText('CF prod');

    expect(screen.queryByText('Add resource')).toBeNull();
    fireEvent.click(screen.getByText('Restrict to specific resources'));

    // The add-resource form (with the known account) is now visible.
    expect(await screen.findByText('Add resource')).toBeDefined();
    // The connection pins an account, so it's shown without a discovery picker.
    expect(screen.getAllByText('a-known').length).toBeGreaterThan(0);
    const calledAccounts = vi
      .mocked(api)
      .mock.calls.some((c) => String(c[0]).includes('/discovery/accounts'));
    expect(calledAccounts).toBe(false);
  });
});

describe('CloudflareTargetsPage — no duplicate resources', () => {
  const accountTarget: CloudflareTarget = {
    id: 't-acc', projectId: 'p1', connectionId: 'c1', kind: 'account', accountId: 'a-known',
    zoneId: null, name: 'CF prod', label: null, workerScripts: null, metadata: {},
    addedByUserId: 'u1', createdAt: '',
  };

  it('blocks re-adding the pinned account that is already in the scope', async () => {
    mockTargets = [accountTarget];
    render(<CloudflareTargetsPage slug="beecause" />);

    // Add-resource form is visible (specific scope, account kind by default).
    expect(await screen.findByText('Add resource')).toBeDefined();
    // The duplicate note appears and Add is disabled.
    expect(screen.getByText(/already in the scope/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /^Add$/ })).toHaveProperty('disabled', true);
  });
});
