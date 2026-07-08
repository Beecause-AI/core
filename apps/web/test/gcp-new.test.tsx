// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import NewGcpConnectionPage from '../src/app/admin/gcp/new/page';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/gcp/new', useRouter: () => ({ push: pushMock }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); pushMock.mockClear(); });

const SA = JSON.stringify({ type: 'service_account', project_id: 'acme-prod', client_email: 'ro@acme-prod.iam', private_key: 'PK' });

function stubFetch(post?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if ((init?.method ?? 'GET') === 'POST' && url.includes('/api/integrations/gcp/connections')) {
      return post ? post(url, init) : new Response(JSON.stringify({ connection: {} }), { status: 200 });
    }
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole: 'owner' }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

describe('NewGcpConnectionPage', () => {
  test('renders one unified JSON credential dropzone (no stacked upload/paste)', async () => {
    stubFetch();
    const { container } = render(<NewGcpConnectionPage />);
    await waitFor(() => expect(screen.getByText('Add a Google Cloud connection')).toBeDefined());
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Browse file/i })).toBeDefined();
  });

  test('uploading a key prefills the project ID, posts it, and returns to the list', async () => {
    let body: { mode?: string; saKey?: string; name?: string; defaultGcpProjectId?: string } | undefined;
    stubFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ connection: {} }), { status: 200 });
    });
    const { container } = render(<NewGcpConnectionPage />);
    await waitFor(() => expect(screen.getByText('Add a Google Cloud connection')).toBeDefined());

    const nameInput = container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Prod SA' } });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([SA], 'key.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByDisplayValue('acme-prod')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Add connection/i }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.mode).toBe('sa_key');
    expect(body?.saKey).toBe(SA);
    expect(body?.defaultGcpProjectId).toBe('acme-prod');
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/gcp'));
  });
});
