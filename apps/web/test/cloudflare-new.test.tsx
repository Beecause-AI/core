// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import NewCloudflareConnectionPage from '../src/app/admin/cloudflare/new/page';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/cloudflare/new', useRouter: () => ({ push: pushMock }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); pushMock.mockClear(); });

function stubFetch(post?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if ((init?.method ?? 'GET') === 'POST' && url.includes('/api/integrations/cloudflare/connections')) {
      return post ? post(url, init) : new Response(JSON.stringify({ connection: {} }), { status: 200 });
    }
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole: 'owner' }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

describe('NewCloudflareConnectionPage', () => {
  test('renders the form with a masked API token input', async () => {
    stubFetch();
    const { container } = render(<NewCloudflareConnectionPage />);
    await waitFor(() => expect(screen.getByText('Add a Cloudflare connection')).toBeDefined());
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(screen.getByPlaceholderText('Scoped read-only token')).toBeDefined();
  });

  test('filling the token + account ID posts it and returns to the list', async () => {
    let body: { mode?: string; apiToken?: string; name?: string; accountId?: string } | undefined;
    stubFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ connection: {} }), { status: 200 });
    });
    render(<NewCloudflareConnectionPage />);
    await waitFor(() => expect(screen.getByText('Add a Cloudflare connection')).toBeDefined());

    fireEvent.change(screen.getByPlaceholderText('Production account'), { target: { value: 'Prod CF' } });
    fireEvent.change(screen.getByPlaceholderText('Scoped read-only token'), { target: { value: 'cf-token-123' } });
    fireEvent.change(screen.getByPlaceholderText('Shown on the API token page'), { target: { value: 'acct-abc' } });

    fireEvent.click(screen.getByRole('button', { name: /Add connection/i }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.mode).toBe('api_token');
    expect(body?.apiToken).toBe('cf-token-123');
    expect(body?.name).toBe('Prod CF');
    expect(body?.accountId).toBe('acct-abc');
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/cloudflare'));
  });
});
