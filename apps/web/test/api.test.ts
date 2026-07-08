import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from '../src/lib/api';

// Capture the headers the api() helper hands to fetch. The production bug: a
// `content-type: application/json` sent on a no-body request (GET/DELETE) made
// Fastify try to parse an empty JSON body and 500. api() must only set the JSON
// content-type when there is actually a request body.
function mockFetch(status = 204) {
  const spy = vi.fn(async () =>
    new Response(status === 204 ? null : JSON.stringify({ ok: true }), {
      status,
      headers: status === 204 ? undefined : { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

function sentHeaders(spy: ReturnType<typeof mockFetch>): Record<string, string> {
  const init = spy.mock.calls[0][1] as RequestInit;
  return (init.headers ?? {}) as Record<string, string>;
}

afterEach(() => vi.unstubAllGlobals());

describe('api() content-type', () => {
  test('omits content-type on a GET with no body', async () => {
    const spy = mockFetch(200);
    await api('/api/x', { method: 'GET' });
    expect(sentHeaders(spy)['content-type']).toBeUndefined();
  });

  test('omits content-type on a DELETE with no body', async () => {
    const spy = mockFetch(204);
    await api('/api/x', { method: 'DELETE' });
    expect(sentHeaders(spy)['content-type']).toBeUndefined();
  });

  test('sets content-type on a PUT with a body', async () => {
    const spy = mockFetch(200);
    await api('/api/x', { method: 'PUT', body: JSON.stringify({ key: 'v' }) });
    expect(sentHeaders(spy)['content-type']).toBe('application/json');
  });

  test('caller-supplied headers still win', async () => {
    const spy = mockFetch(200);
    await api('/api/x', { method: 'GET', headers: { 'x-custom': '1' } });
    expect(sentHeaders(spy)['x-custom']).toBe('1');
  });
});

describe('api() 401 handling', () => {
  test('redirects to /signin and never settles, so the UI shows no raw error', async () => {
    mockFetch(401);
    const orig = window.location;
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { set href(v: string) { hrefSpy(v); }, get href() { return ''; } },
    });
    try {
      const pending = api('/api/me');
      const outcome = await Promise.race([
        pending.then(() => 'settled', () => 'settled'),
        new Promise((r) => setTimeout(() => r('pending'), 30)),
      ]);
      expect(hrefSpy).toHaveBeenCalledWith('/signin');
      expect(outcome).toBe('pending'); // no resolve/reject → no error rendered
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: orig });
    }
  });
});
