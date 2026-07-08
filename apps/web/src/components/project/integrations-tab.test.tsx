import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { CloudflareConnection, CloudflareTarget, GcpConnection, GcpTarget } from '../../lib/api';

// The card resolves the Cloudflare summary from two endpoints:
//   GET …/cloudflare/connection → the bound connection (or null = not connected)
//   GET …/cloudflare/targets    → the scope's resources (empty + bound = "All resources")
let mockCfConnection: CloudflareConnection | null = null;
let mockCfTargets: CloudflareTarget[] = [];
// GCP mirrors the same connection + scope model:
//   GET …/gcp/connection → the bound connection (or null = not connected)
//   GET …/gcp/targets    → the scope's projects (empty + bound = "All projects")
let mockGcpConnection: GcpConnection | null = null;
let mockGcpTargets: GcpTarget[] = [];

vi.mock('../../lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.endsWith('/cloudflare/connection')) return Promise.resolve({ connection: mockCfConnection });
    if (path.endsWith('/cloudflare/targets')) return Promise.resolve({ targets: mockCfTargets });
    if (path.endsWith('/gcp/connection')) return Promise.resolve({ connection: mockGcpConnection });
    if (path.endsWith('/gcp/targets')) return Promise.resolve({ targets: mockGcpTargets });
    if (path.endsWith('/repos')) return Promise.resolve([]);
    if (path.endsWith('/slack-channels')) return Promise.resolve({ connected: false, assigned: [] });
    // The tab also fetches sentry/grafana/aws/azure (not under test here) — return empty
    // defaults so the component renders instead of crashing on an undefined `.targets`/`.connection`.
    if (path.endsWith('/sentry/connection') || path.endsWith('/grafana/connection')) return Promise.resolve({ connection: null });
    if (path.endsWith('/sentry/targets') || path.endsWith('/grafana/targets') || path.endsWith('/aws/targets') || path.endsWith('/azure/targets')) return Promise.resolve({ targets: [] });
    return Promise.resolve({});
  }),
}));

import { IntegrationsTab } from './integrations-tab';

const conn: CloudflareConnection = {
  id: 'c1', orgId: 'o1', projectId: null, name: 'Prod', mode: 'api_token', enabled: true,
  metadata: { accountId: 'a1' }, lastTestedAt: null, lastTestOk: null, createdAt: '',
};
const target: CloudflareTarget = {
  id: 't1', projectId: 'p1', connectionId: 'c1', kind: 'zone', accountId: 'a1', zoneId: 'z1',
  name: 'beecause.ai', label: null, workerScripts: null, metadata: {}, addedByUserId: 'u1', createdAt: '',
};

const gcpConn: GcpConnection = {
  id: 'g1', orgId: 'o1', projectId: null, name: 'Prod', mode: 'sa_key', enabled: true,
  metadata: { saEmail: 'sa@prod.iam.gserviceaccount.com' }, lastTestedAt: null, lastTestOk: null, createdAt: '',
};
const gcpTarget: GcpTarget = {
  id: 'gt1', projectId: 'p1', connectionId: 'g1', gcpProjectId: 'prod-123', label: null,
  metadata: {}, addedByUserId: 'u1', createdAt: '',
};

beforeEach(() => { mockCfConnection = null; mockCfTargets = []; mockGcpConnection = null; mockGcpTargets = []; });
afterEach(() => cleanup());

// Scope a summary assertion to one integration's card (the <a> linking to its page),
// since multiple cards can share a summary like "Not connected".
const card = (label: string) => screen.getByText(label).closest('a') as HTMLElement;

describe('IntegrationsTab — Cloudflare summary', () => {
  it('shows "Not connected" when no connection is bound', async () => {
    render(<IntegrationsTab slug="beecause" isAdmin />);
    expect(await within(card('Cloudflare')).findByText('Not connected')).toBeDefined();
  });

  it('shows "All resources" when bound with an empty (unrestricted) scope', async () => {
    mockCfConnection = conn;
    mockCfTargets = [];
    render(<IntegrationsTab slug="beecause" isAdmin />);
    expect(await within(card('Cloudflare')).findByText('All resources')).toBeDefined();
  });

  it('counts resources (not "scopes") when the scope is specific', async () => {
    mockCfConnection = conn;
    mockCfTargets = [target, { ...target, id: 't2', kind: 'account', zoneId: null, name: 'Prod' }];
    render(<IntegrationsTab slug="beecause" isAdmin />);
    expect(await within(card('Cloudflare')).findByText('2 resources')).toBeDefined();
    expect(screen.queryByText(/scopes?$/)).toBeNull();
  });
});

describe('IntegrationsTab — GCP summary', () => {
  it('shows "Not connected" when no connection is bound', async () => {
    render(<IntegrationsTab slug="beecause" isAdmin />);
    expect(await within(card('Google Cloud')).findByText('Not connected')).toBeDefined();
  });

  it('shows "All projects" when bound with an empty (unrestricted) scope', async () => {
    mockGcpConnection = gcpConn;
    mockGcpTargets = [];
    render(<IntegrationsTab slug="beecause" isAdmin />);
    expect(await within(card('Google Cloud')).findByText('All projects')).toBeDefined();
  });

  it('counts projects when the scope is specific', async () => {
    mockGcpConnection = gcpConn;
    mockGcpTargets = [gcpTarget, { ...gcpTarget, id: 'gt2', gcpProjectId: 'staging-456' }];
    render(<IntegrationsTab slug="beecause" isAdmin />);
    expect(await within(card('Google Cloud')).findByText('2 projects')).toBeDefined();
  });
});
