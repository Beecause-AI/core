import { describe, expect, it, vi } from 'vitest';
import { makeIdpSignIn, IdpInvalidCredentialsError } from '../src/integrations/idp/signin.js';

const okBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ localId: 'kc-sub-1', email: 'a@b.co', displayName: 'Ada Lovelace', idToken: 'ID.TOK.EN', ...over });

describe('makeIdpSignIn', () => {
  it('calls signInWithPassword with the api key, tenant, and returnSecureToken; maps the result', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(okBody(), { status: 200 }); });
    const signIn = makeIdpSignIn('KEY123', fetcher as unknown as typeof fetch);
    const out = await signIn('tenant-acme', 'a@b.co', 'pw');
    expect(out).toEqual({ uid: 'kc-sub-1', email: 'a@b.co', name: 'Ada Lovelace', idToken: 'ID.TOK.EN' });
    expect(calls[0]!.url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=KEY123');
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toEqual({ email: 'a@b.co', password: 'pw', returnSecureToken: true, tenantId: 'tenant-acme' });
  });

  it('omits name when displayName is absent', async () => {
    const fetcher = vi.fn(async () => new Response(okBody({ displayName: undefined }), { status: 200 }));
    const out = await makeIdpSignIn('K', fetcher as unknown as typeof fetch)('t', 'a@b.co', 'pw');
    expect(out.name).toBeUndefined();
  });

  it('throws IdpInvalidCredentialsError on HTTP 400 (bad email/password)', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }), { status: 400 }));
    await expect(makeIdpSignIn('K', fetcher as unknown as typeof fetch)('t', 'a@b.co', 'bad'))
      .rejects.toBeInstanceOf(IdpInvalidCredentialsError);
  });

  it('throws a generic error on other non-OK statuses', async () => {
    const fetcher = vi.fn(async () => new Response('boom', { status: 503 }));
    await expect(makeIdpSignIn('K', fetcher as unknown as typeof fetch)('t', 'a@b.co', 'pw'))
      .rejects.toThrow('idp signIn → 503');
  });
});
