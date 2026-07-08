// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import IntegrationsPage from '../src/app/admin/integrations/page';
import type { GcpConnection, GithubConnection } from '../src/lib/api';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/integrations' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubFetch(opts: { conn?: GithubConnection | null; myOrgRole?: string; gcpConnections?: GcpConnection[] }) {
  const { conn = null, myOrgRole = 'owner', gcpConnections = [] } = opts;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/github/connection')) return new Response(conn === null ? 'null' : JSON.stringify(conn), { status: 200 });
    if (url.includes('/api/integrations/cloudflare/connections')) return new Response(JSON.stringify({ connections: [] }), { status: 200 });
    if (url.includes('/api/integrations/gcp/connections')) return new Response(JSON.stringify({ connections: gcpConnections }), { status: 200 });
    // The old singular GCP status endpoint was removed in v2; the page must NOT call it.
    // 404 here so a regression back to it rejects the Promise.all → "Not authorized" → test fails.
    if (url.endsWith('/api/integrations/gcp')) return new Response('not found', { status: 404 });
    if (url.includes('/api/org/projects')) return new Response('[]', { status: 200 });
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

const connected: GithubConnection = {
  provider: 'github', mode: 'agent_app', baseUrl: null, accountLabel: 'acme-corp', secretHint: null,
  enabled: true, lastTestedAt: null, lastTestOk: true, metadata: { installationId: '5' },
};

const gcpConn: GcpConnection = {
  id: 'g1', orgId: 'o1', projectId: null, name: 'Prod SA', mode: 'sa_key', enabled: true,
  metadata: { defaultGcpProjectId: 'acme-prod' }, lastTestedAt: null, lastTestOk: true, createdAt: '',
};

describe('IntegrationsPage', () => {
  test('lists GitHub, Slack, Microsoft Teams, Google Cloud and Cloudflare as connectable, all not connected', async () => {
    stubFetch({ conn: null });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('GitHub')).toBeDefined());
    expect(screen.getByText('Slack')).toBeDefined();
    expect(screen.getByText('Microsoft Teams')).toBeDefined();
    expect(screen.getByText('Google Cloud')).toBeDefined();
    expect(screen.getByText('Cloudflare')).toBeDefined();
    // all providers are connectable now; with no connection each shows "Not connected"
    // (github, gitlab, slack, teams, gcp, cloudflare, sentry, grafana, aws, azure, datadog, dynatrace, pagerduty)
    expect(screen.getAllByText('Not connected')).toHaveLength(13);
  });

  test('shows GitHub connected status with account', async () => {
    stubFetch({ conn: connected });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText(/Connected · acme-corp/)).toBeDefined());
  });

  test('owner with a GCP connection sees it connected (and is NOT shown "Not authorized")', async () => {
    stubFetch({ conn: null, gcpConnections: [gcpConn] });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Google Cloud')).toBeDefined());
    expect(screen.queryByText('Not authorized')).toBeNull();
    expect(screen.getByText(/Connected · 1 connection/)).toBeDefined();
  });

  test('non-admin sees Not authorized', async () => {
    stubFetch({ conn: null, myOrgRole: 'user' });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Not authorized')).toBeDefined());
  });
});
