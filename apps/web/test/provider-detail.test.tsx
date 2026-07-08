// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ProviderDetail } from '../src/components/provider-detail';
import type { ModelKey } from '../src/lib/api';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/ai-providers/anthropic' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(opts: { keys?: ModelKey[]; myOrgRole?: string; put?: Handler; post?: Handler; del?: Handler }) {
  const { keys = [], myOrgRole = 'owner', put, post, del } = opts;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (method === 'PUT' && put) return put(url, init);
    if (method === 'POST' && post) return post(url, init);
    if (method === 'DELETE' && del) return del(url, init);
    if (url.includes('/api/model-keys')) return new Response(JSON.stringify(keys), { status: 200 });
    if (url.includes('/api/org/projects')) return new Response('[]', { status: 200 });
    if (url.includes('/api/org')) return new Response(JSON.stringify({ slug: 'acme', name: 'Acme', myOrgRole }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}

const validAnthropic: ModelKey = {
  provider: 'anthropic', keyHint: '…abcd', enabled: true, baseUrl: null,
  lastTestedAt: '2026-06-01T00:00:00.000Z', lastTestOk: true,
};

describe('ProviderDetail', () => {
  test('not configured: renders the provider label and the API-key form', async () => {
    stubFetch({ keys: [] });
    const { container } = render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Anthropic (Claude)' })).toBeDefined());
    const pwd = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwd).not.toBeNull();
    expect(pwd.value).toBe('');
    expect(screen.getByRole('button', { name: /save & test/i })).toBeDefined();
  });

  test('back link points to the hub', async () => {
    stubFetch({ keys: [] });
    render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByText(/AI Providers/i)).toBeDefined());
    expect(screen.getByText(/← AI Providers/i).closest('a')?.getAttribute('href')).toBe('/admin/ai-providers');
  });

  test('openai-compatible not configured: renders a Base URL field', async () => {
    stubFetch({ keys: [] });
    const { container } = render(<ProviderDetail providerId="openai-compatible" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Custom (OpenAI-compatible)' })).toBeDefined());
    expect(container.querySelector('input[type="url"]')).not.toBeNull();
  });

  test('configured: renders the management panel (status, key hint, controls)', async () => {
    stubFetch({ keys: [validAnthropic] });
    render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByText('…abcd')).toBeDefined());
    expect(screen.getByText('Connected')).toBeDefined();
    expect(screen.getByRole('button', { name: /^test$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /replace/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /disable/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /remove/i })).toBeDefined();
  });

  test('Save & test SUCCESS flips to configured', async () => {
    stubFetch({ keys: [], put: () => new Response(JSON.stringify(validAnthropic), { status: 201 }) });
    const { container } = render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save & test/i })).toBeDefined());
    fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'sk-ant-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /save & test/i }));
    await waitFor(() => expect(screen.getByText('…abcd')).toBeDefined());
    expect(screen.getByText('Connected')).toBeDefined();
  });

  test('Save & test REJECT surfaces the detail and stays unconfigured', async () => {
    stubFetch({
      keys: [],
      put: () => new Response(JSON.stringify({ error: 'key rejected', detail: 'invalid x-api-key' }), { status: 400 }),
    });
    const { container } = render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save & test/i })).toBeDefined());
    fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: /save & test/i }));
    await waitFor(() => expect(screen.getByText(/invalid x-api-key/i)).toBeDefined());
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  test('Remove (confirmed) drops back to the empty form', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    stubFetch({ keys: [validAnthropic], del: () => new Response('{}', { status: 200 }) });
    const { container } = render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByText('…abcd')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(container.querySelector('input[type="password"]')).not.toBeNull());
    expect(screen.queryByText('…abcd')).toBeNull();
  });

  test('unknown provider id renders the empty state', async () => {
    stubFetch({ keys: [] });
    render(<ProviderDetail providerId="nope" />);
    await waitFor(() => expect(screen.getByText('Unknown provider')).toBeDefined());
  });

  test('non-admin sees the not-authorized state', async () => {
    stubFetch({ keys: [validAnthropic], myOrgRole: 'user' });
    const { container } = render(<ProviderDetail providerId="anthropic" />);
    await waitFor(() => expect(screen.getByText('Not authorized')).toBeDefined());
    expect(container.querySelector('input')).toBeNull();
  });
});
