import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerFor, passwordSignIn, registerLocal } from '../src/lib/idp-auth';

afterEach(() => vi.restoreAllMocks());

describe('providerFor', () => {
  it('returns a SAML provider for saml.* ids', () => {
    expect(providerFor('saml.acme').providerId).toBe('saml.acme');
  });
  it('returns an OIDC provider for oidc.* ids', () => {
    expect(providerFor('oidc.acme').providerId).toBe('oidc.acme');
  });
  it('throws on an unknown provider id', () => {
    expect(() => providerFor('weird.acme')).toThrow();
  });
});

describe('passwordSignIn', () => {
  it('POSTs credentials to /auth/password and resolves on 200', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await passwordSignIn('a@b.co', 'pw');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/auth/password');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.co', password: 'pw' });
  });
  it('throws "invalid" on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(passwordSignIn('a@b.co', 'bad')).rejects.toThrow('invalid');
  });
  it('throws generic on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(passwordSignIn('a@b.co', 'pw')).rejects.toThrow();
  });
});

describe('registerLocal', () => {
  it('POSTs to /auth/register and resolves on 201', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }));
    await registerLocal('a@b.co', 'longenough', 'Alice');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/auth/register');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.co', password: 'longenough', name: 'Alice' });
  });
  it('omits name when not provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }));
    await registerLocal('a@b.co', 'longenough');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.co', password: 'longenough' });
  });
  it('throws "disabled" on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(registerLocal('a@b.co', 'longenough')).rejects.toThrow('disabled');
  });
  it('throws "conflict" on 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    await expect(registerLocal('a@b.co', 'longenough')).rejects.toThrow('conflict');
  });
  it('throws generic on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(registerLocal('a@b.co', 'longenough')).rejects.toThrow();
  });
});
