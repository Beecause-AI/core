import { describe, it, expect } from 'vitest';
import { makeCloudflareClientForTest } from './client.js';

type Call = { url: string; init: any };

function fakeFetch(responses: Record<string, any>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: any) => {
    calls.push({ url, init });
    const body = responses[url] ?? responses['*'] ?? { result: null };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { impl, calls };
}

const H = { Authorization: 'Bearer tok' };

describe('CloudflareClient', () => {
  it('posts GraphQL queries with auth headers + variables', async () => {
    const { impl, calls } = fakeFetch({ 'https://api.cloudflare.com/client/v4/graphql': { data: { viewer: {} } } });
    const client = makeCloudflareClientForTest(impl);
    const out = await client.queryGraphql(H, '{ viewer { __typename } }', { a: 1 });
    expect(out).toEqual({ data: { viewer: {} } });
    expect(calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ query: '{ viewer { __typename } }', variables: { a: 1 } });
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer tok');
  });

  it('verifyToken hits the token verify endpoint', async () => {
    const { impl, calls } = fakeFetch({ '*': { result: { status: 'active' } } });
    const client = makeCloudflareClientForTest(impl);
    await client.verifyToken(H);
    expect(calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/user/tokens/verify');
  });

  it('throws with status + body on a non-ok response', async () => {
    const impl = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' });
    const client = makeCloudflareClientForTest(impl as any);
    await expect(client.queryGraphql(H, '{x}')).rejects.toThrow(/Cloudflare 403: forbidden/);
  });

  it('listWorkerScripts GETs the account scripts endpoint', async () => {
    const { impl, calls } = fakeFetch({ '*': { result: [] } });
    const client = makeCloudflareClientForTest(impl);
    await client.listWorkerScripts(H, 'acct-1');
    expect(calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct-1/workers/scripts');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('queryWorkerLogs posts numeric epoch timeframe + events view to the account endpoint', async () => {
    const { impl, calls } = fakeFetch({ '*': { result: [] } });
    const client = makeCloudflareClientForTest(impl);
    await client.queryWorkerLogs(H, 'acct-1', { window: '15m' });
    expect(calls[0]!.url).toContain('/accounts/acct-1/');
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body);
    expect(typeof body.timeframe.from).toBe('number');
    expect(typeof body.timeframe.to).toBe('number');
    expect(body.timeframe.to).toBeGreaterThan(body.timeframe.from);
    expect(body.view).toBe('events');
    expect(body).not.toHaveProperty('query');
    expect(body.parameters.filters).toEqual([]);
  });

  it('queryWorkerLogs adds a scriptName filter when scripts are provided', async () => {
    const { impl, calls } = fakeFetch({ '*': { result: [] } });
    const client = makeCloudflareClientForTest(impl);
    await client.queryWorkerLogs(H, 'acct-1', { window: '15m', scripts: ['pay-worker'] });
    const body = JSON.parse(calls[0]!.init.body);
    expect(body.parameters.filters.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.parameters.filters)).toContain('pay-worker');
  });
});
