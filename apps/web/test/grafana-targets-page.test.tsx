// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { GrafanaConnection, GrafanaTarget, GrafanaSignalReport } from '../src/lib/api';

let mockConnection: GrafanaConnection | null = null;
let mockConnections: GrafanaConnection[] = [];
let mockTargets: GrafanaTarget[] = [];
let mockDiscovery: { datasources: { uid: string; name: string; type: string }[] } | Error = { datasources: [] };
let mockVerify: { report: GrafanaSignalReport; availableSignals: string[] } = {
  report: { metrics: { ok: true }, logs: { ok: true }, traces: { ok: false } },
  availableSignals: ['metrics', 'logs'],
};

vi.mock('../src/lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.includes('/discovery/datasources')) {
      return mockDiscovery instanceof Error ? Promise.reject(mockDiscovery) : Promise.resolve(mockDiscovery);
    }
    if (path.endsWith('/connection/verify')) return Promise.resolve(mockVerify);
    if (path.endsWith('/connection')) return Promise.resolve({ connection: mockConnection });
    if (path.endsWith('/connections')) return Promise.resolve({ connections: mockConnections });
    if (path.endsWith('/targets')) return Promise.resolve({ targets: mockTargets });
    return Promise.resolve({});
  }),
}));

import { api } from '../src/lib/api';
import { GrafanaTargetsPage } from '../src/components/project/grafana-targets-page';

const conn: GrafanaConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'Grafana prod', mode: 'grafana',
  baseUrl: 'https://grafana.acme.io', enabled: true, metadata: {},
  secretHint: '…oken', lastTestedAt: null, lastTestOk: null, createdAt: '',
};

beforeEach(() => {
  vi.mocked(api).mockClear();
  mockConnection = conn;
  mockConnections = [conn];
  mockTargets = [];
  mockDiscovery = { datasources: [{ uid: 'p1', name: 'Prometheus', type: 'prometheus' }, { uid: 'l1', name: 'Loki', type: 'loki' }] };
  mockVerify = { report: { metrics: { ok: true }, logs: { ok: true }, traces: { ok: false } }, availableSignals: ['metrics', 'logs'] };
});

afterEach(() => cleanup());

describe('GrafanaTargetsPage', () => {
  it('shows the bound connection and an unrestricted scope', async () => {
    render(<GrafanaTargetsPage slug="beecause" />);
    expect(await screen.findByText('Grafana prod')).toBeDefined();
    expect(screen.getByText('https://grafana.acme.io')).toBeDefined();
    expect(screen.getByText(/can query any datasource/i)).toBeDefined();
  });

  it('verifies the bound connection and shows the report + pills', async () => {
    render(<GrafanaTargetsPage slug="beecause" />);
    await screen.findByText('Grafana prod');
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    expect(await screen.findByText(/verification report/i)).toBeDefined();
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/org/projects/beecause/grafana/connection/verify', expect.anything()));
  });

  it('reveals the add-datasource form when restricting and filters scoped datasources out', async () => {
    mockTargets = [{ id: 't1', projectId: 'p', connectionId: 'c1', datasourceUid: 'p1', datasourceType: 'prometheus', name: 'Prometheus', label: null, addedByUserId: 'u', createdAt: '' }];
    render(<GrafanaTargetsPage slug="beecause" />);
    expect(await screen.findByText('Add datasource')).toBeDefined();
    expect(await screen.findByText('Loki (loki)')).toBeDefined();
    expect(screen.queryByText('Prometheus (prometheus)')).toBeNull();
  });
});
