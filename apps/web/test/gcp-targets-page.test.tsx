// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { GcpConnection, GcpSignalReport, GcpTarget } from '../src/lib/api';

// The page resolves its connection + scope via the mocked api():
//   GET ${base}/connection            → the bound connection (or null)
//   GET ${base}/connections           → the choosable connections
//   GET ${base}/targets               → the scope's allowed projects (empty = unrestricted)
//   GET ${base}/discovery/projects    → discoverable GCP projects (may error → manual fallback)
let mockConnection: GcpConnection | null = null;
let mockConnections: GcpConnection[] = [];
let mockTargets: GcpTarget[] = [];
let mockDiscovery: { result: { id: string; name: string }[] } | Error = { result: [] };
let mockVerify: { report: GcpSignalReport; availableSignals: string[] } = {
  report: { monitoring: { ok: true }, logging: { ok: true }, trace: { ok: true } },
  availableSignals: ['monitoring', 'logging', 'trace'],
};

vi.mock('../src/lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.includes('/discovery/projects')) {
      return mockDiscovery instanceof Error
        ? Promise.reject(mockDiscovery)
        : Promise.resolve(mockDiscovery);
    }
    if (path.endsWith('/connection/verify')) return Promise.resolve(mockVerify);
    if (path.endsWith('/connection')) return Promise.resolve({ connection: mockConnection });
    if (path.endsWith('/connections')) return Promise.resolve({ connections: mockConnections });
    if (path.endsWith('/targets')) return Promise.resolve({ targets: mockTargets });
    return Promise.resolve({ result: [] });
  }),
}));

import { api } from '../src/lib/api';
import { GcpTargetsPage } from '../src/components/project/gcp-targets-page';

const conn: GcpConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'GCP prod', mode: 'sa_key', enabled: true,
  metadata: { saEmail: 'ro@acme.iam', defaultGcpProjectId: 'acme-prod' },
  lastTestedAt: null, lastTestOk: null, createdAt: '',
};

beforeEach(() => {
  vi.mocked(api).mockClear();
  mockConnection = conn;
  mockConnections = [conn];
  mockTargets = [];
  mockDiscovery = { result: [{ id: 'acme-prod', name: 'Acme Prod' }, { id: 'acme-stg', name: 'Acme Staging' }] };
  mockVerify = {
    report: { monitoring: { ok: true }, logging: { ok: true }, trace: { ok: true } },
    availableSignals: ['monitoring', 'logging', 'trace'],
  };
});

afterEach(() => cleanup());

describe('GcpTargetsPage — bound connection, unrestricted scope', () => {
  it('shows the bound connection and an unrestricted "All projects" scope', async () => {
    render(<GcpTargetsPage slug="beecause" />);

    // bound connection name + default project id (faint)
    expect(await screen.findByText('GCP prod')).toBeDefined();
    expect(screen.getByText('acme-prod')).toBeDefined();

    // Scope defaults to All projects with the unrestricted blurb.
    expect(
      screen.getByText(/can query any GCP project this connection/i),
    ).toBeDefined();
  });

  it('reveals the add-project form when restricting to specific projects', async () => {
    render(<GcpTargetsPage slug="beecause" />);
    await screen.findByText('GCP prod');

    expect(screen.queryByText('Add GCP project')).toBeNull();
    fireEvent.click(screen.getByText('Restrict to specific projects'));

    expect(await screen.findByText('Add GCP project')).toBeDefined();
  });
});

describe('GcpTargetsPage — persistent signal pills', () => {
  it('renders section pills from the persisted last-check result without clicking Verify', async () => {
    mockConnection = {
      ...conn,
      lastTestedAt: '2026-06-15T00:00:00.000Z',
      lastTestOk: true,
      metadata: { ...conn.metadata, availableSignals: ['monitoring', 'logging'] },
    };
    mockConnections = [mockConnection];
    render(<GcpTargetsPage slug="beecause" />);
    await screen.findByText('GCP prod');

    // Section labels are present on initial render — no Verify click.
    expect(screen.getByText('Metrics')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Traces')).toBeDefined();
  });
});

describe('GcpTargetsPage — verify bound connection', () => {
  it('shows a Verify button and refreshes the per-signal pills + last-checked line', async () => {
    render(<GcpTargetsPage slug="beecause" />);
    await screen.findByText('GCP prod');

    const verifyBtn = screen.getByRole('button', { name: /^Verify$/ });
    expect(verifyBtn).toBeDefined();
    fireEvent.click(verifyBtn);

    // Verify opens the report modal; section labels now appear in both the pills
    // and the modal, so assert at least one of each is present.
    expect(await screen.findByText(/verification report/i)).toBeDefined();
    expect(screen.getAllByText('Metrics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Logs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Traces').length).toBeGreaterThan(0);

    // Persisted last-checked line updates to OK.
    await waitFor(() => expect(screen.getByText(/Checked .* · OK/)).toBeDefined());

    expect(api).toHaveBeenCalledWith(
      '/api/org/projects/beecause/gcp/connection/verify',
      { method: 'POST' },
    );
  });
});

describe('GcpTargetsPage — no duplicate projects', () => {
  const projectTarget: GcpTarget = {
    id: 't-acme', projectId: 'p1', connectionId: 'c1',
    gcpProjectId: 'acme-prod', label: 'prod',
    metadata: {}, addedByUserId: 'u1', createdAt: '',
  };

  it('blocks re-adding a GCP project already in the scope', async () => {
    mockTargets = [projectTarget];
    render(<GcpTargetsPage slug="beecause" />);

    // Add form is visible (specific scope because a target exists).
    expect(await screen.findByText('Add GCP project')).toBeDefined();

    // The already-added project is hidden from the picker; select via manual entry.
    // Discovery succeeds but excludes the dupe, so pick the remaining one then
    // type the dupe id into the manual input to trigger the guard.
    const manualToggle = screen.queryByText(/Enter a project ID manually/i);
    if (manualToggle) fireEvent.click(manualToggle);
    const input = screen.getByPlaceholderText(/project id/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'acme-prod' } });

    expect(screen.getByText(/already in the scope/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /^Add$/ })).toHaveProperty('disabled', true);
  });

  it('filters projects already in the scope out of the discovery picker', async () => {
    // Discovery returns two projects; one (acme-prod) is already in scope.
    mockDiscovery = {
      result: [
        { id: 'acme-prod', name: 'Acme Prod' },
        { id: 'acme-stg', name: 'Acme Staging' },
      ],
    };
    mockTargets = [projectTarget]; // acme-prod already in scope → specific view

    render(<GcpTargetsPage slug="beecause" />);

    // Add form is visible because a target exists.
    expect(await screen.findByText('Add GCP project')).toBeDefined();

    // The picker lists the available project but omits the already-scoped dupe.
    expect(await screen.findByText('Acme Staging')).toBeDefined();
    expect(screen.queryByText('Acme Prod')).toBeNull();
  });
});
