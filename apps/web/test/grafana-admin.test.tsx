// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { GrafanaConnection } from '../src/lib/api';

let mockConnections: GrafanaConnection[] = [];

vi.mock('../src/lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path === '/api/org') return Promise.resolve({ slug: 'acme', name: 'Acme', myOrgRole: 'owner', kgEnabled: false, hindsightEnabled: false, showCostUsd: false, debugEnabled: false });
    if (path.endsWith('/grafana/connections')) return Promise.resolve({ connections: mockConnections });
    return Promise.resolve({});
  }),
  ApiError: class extends Error {},
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/grafana', useRouter: () => ({ push: vi.fn() }) }));

import GrafanaPage from '../src/app/admin/grafana/page';

const conn: GrafanaConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'Grafana prod', mode: 'grafana',
  baseUrl: 'https://grafana.acme.io', enabled: true,
  metadata: { availableSignals: ['metrics', 'logs'] },
  secretHint: '…oken', lastTestedAt: '2026-06-20T00:00:00.000Z', lastTestOk: true, createdAt: '',
};

beforeEach(() => { mockConnections = [conn]; });
afterEach(() => cleanup());

describe('GrafanaPage (admin)', () => {
  it('lists a connection with its base URL and persisted signal pills', async () => {
    render(<GrafanaPage />);
    expect(await screen.findByText('Grafana prod')).toBeDefined();
    expect(screen.getByText('https://grafana.acme.io')).toBeDefined();
    await waitFor(() => expect(screen.getByText('Metrics')).toBeDefined());
    expect(screen.getByText('Traces')).toBeDefined();
  });
});
