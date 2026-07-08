import { describe, expect, it } from 'vitest';
import { probeProvider, assertSafeBaseUrl } from '../src/providers/probe.js';

function fakeFetch(status: number, body = '') {
  return async (_url: string, _init?: any) => ({ ok: status >= 200 && status < 300, status, text: async () => body } as any);
}

describe('probeProvider', () => {
  it('valid key (200) → ok', async () => {
    const r = await probeProvider('openai', 'sk-x', { fetchImpl: fakeFetch(200, '{"data":[]}') as any });
    expect(r.ok).toBe(true);
  });
  it('rejected key (401) → not ok + clean detail, no leaked provider body', async () => {
    const body = '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011Cbxf15"}';
    const r = await probeProvider('anthropic', 'bad', { fetchImpl: fakeFetch(401, body) as any });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.detail).toMatch(/invalid/i);
    // The raw provider JSON (request_id, internal shapes) must NOT reach the operator.
    expect(r.detail).not.toContain('request_id');
    expect(r.detail).not.toContain('{');
  });
  it('hits the right URL+header per provider', async () => {
    const seen: any = {};
    const spy = (async (url: string, init: any) => { seen.url = url; seen.init = init; return { ok: true, status: 200, text: async () => '' }; }) as any;
    await probeProvider('google', 'g', { fetchImpl: spy });
    expect(seen.url).toContain('generativelanguage.googleapis.com');
    expect(seen.init.headers['x-goog-api-key']).toBe('g');
    await probeProvider('anthropic', 'a', { fetchImpl: spy });
    expect(seen.init.headers['x-api-key']).toBe('a');
    expect(seen.init.headers['anthropic-version']).toBeTruthy();
    await probeProvider('openai', 'o', { fetchImpl: spy });
    expect(seen.init.headers.authorization).toBe('Bearer o');
  });
  it('custom uses baseUrl + Bearer', async () => {
    const seen: any = {};
    const spy = (async (url: string, init: any) => { seen.url = url; seen.init = init; return { ok: true, status: 200, text: async () => '' }; }) as any;
    await probeProvider('openai-compatible', 'k', { baseUrl: 'https://api.groq.com/openai/v1', fetchImpl: spy });
    expect(seen.url).toBe('https://api.groq.com/openai/v1/models');
    expect(seen.init.headers.authorization).toBe('Bearer k');
  });
  it('network error → not ok, unreachable', async () => {
    const r = await probeProvider('openai', 'k', { fetchImpl: (async () => { throw new Error('boom'); }) as any });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/reach/i);
  });
  it('unknown provider → not ok', async () => {
    const r = await probeProvider('nope', 'k', { fetchImpl: fakeFetch(200) as any });
    expect(r.ok).toBe(false);
  });
});

describe('assertSafeBaseUrl', () => {
  it('accepts a public https url', () => { expect(() => assertSafeBaseUrl('https://api.groq.com/openai/v1')).not.toThrow(); });
  it.each(['http://api.groq.com', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/v1', 'https://10.0.0.1/v1', 'https://192.168.1.5/v1', 'https://172.16.0.1/v1', 'https://metadata.google.internal/v1', 'https://[::1]/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://[fc00::1]/v1', 'https://[fe80::1]/v1', 'https://[2001:4860:4860::8888]/v1', 'ftp://x', 'not-a-url'])('rejects %s', (u) => {
    expect(() => assertSafeBaseUrl(u)).toThrow();
  });
});
