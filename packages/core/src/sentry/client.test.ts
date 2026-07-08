import { describe, it, expect } from 'vitest';
import { makeSentryClientForTest } from './client.js';

type Call = { url: string; init?: any };

function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: any) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    return { ok: true, status: 200, json: async () => routes[key], text: async () => JSON.stringify(routes[key]) };
  };
  return { impl, calls };
}

const headers = { Authorization: 'Bearer tok' };

describe('sentry client', () => {
  it('getOrganization hits {baseUrl}/api/0/organizations/{slug}/ with auth', async () => {
    const { impl, calls } = fakeFetch({ '/api/0/organizations/acme/': { slug: 'acme' } });
    const client = makeSentryClientForTest(impl as any);
    const out = await client.getOrganization('https://sentry.io', headers, 'acme');
    expect(out).toEqual({ slug: 'acme' });
    expect(calls[0]!.url).toBe('https://sentry.io/api/0/organizations/acme/');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer tok');
  });

  it('trims a trailing slash on baseUrl (self-hosted)', async () => {
    const { impl, calls } = fakeFetch({ '/api/0/organizations/acme/projects/': [] });
    const client = makeSentryClientForTest(impl as any);
    await client.listProjects('https://sentry.example.com/', headers, 'acme');
    expect(calls[0]!.url).toBe('https://sentry.example.com/api/0/organizations/acme/projects/');
  });

  it('listIssues targets the project issues endpoint and forwards query params', async () => {
    const { impl, calls } = fakeFetch({ '/issues/': [{ id: '1' }] });
    const client = makeSentryClientForTest(impl as any);
    const out = await client.listIssues('https://sentry.io', headers, 'acme', 'web', { query: 'is:unresolved', statsPeriod: '24h', sort: 'freq', limit: 10 });
    expect(out).toEqual([{ id: '1' }]);
    const url = calls[0]!.url;
    expect(url).toContain('/api/0/projects/acme/web/issues/');
    expect(url).toContain('query=is%3Aunresolved');
    expect(url).toContain('statsPeriod=24h');
    expect(url).toContain('sort=freq');
    expect(url).toContain('limit=10');
  });

  it('getIssue and getLatestEvent use the org-scoped issue endpoints', async () => {
    const { impl, calls } = fakeFetch({
      '/api/0/organizations/acme/issues/42/events/latest/': { eventID: 'e1' },
      '/api/0/organizations/acme/issues/42/': { id: '42' },
    });
    const client = makeSentryClientForTest(impl as any);
    expect(await client.getIssue('https://sentry.io', headers, 'acme', '42')).toEqual({ id: '42' });
    expect(await client.getLatestEvent('https://sentry.io', headers, 'acme', '42')).toEqual({ eventID: 'e1' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://sentry.io/api/0/organizations/acme/issues/42/',
      'https://sentry.io/api/0/organizations/acme/issues/42/events/latest/',
    ]);
  });

  it('throws a helpful error on non-ok responses', async () => {
    const impl = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' });
    const client = makeSentryClientForTest(impl as any);
    await expect(client.getOrganization('https://sentry.io', headers, 'acme')).rejects.toThrow(/Sentry 403/);
  });
});
