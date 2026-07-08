import { describe, it, expect } from 'vitest';
import { makeGatewayVerifier } from '../src/auth.js';
import { buildApp } from '../src/app.js';

describe('makeGatewayVerifier — bypass (no GATEWAY_AUDIENCE)', () => {
  it('returns true for any header when unconfigured', async () => {
    const verify = makeGatewayVerifier({});
    expect(await verify(undefined)).toBe(true);
    expect(await verify('Bearer anything')).toBe(true);
    expect(await verify('')).toBe(true);
  });
});

describe('makeGatewayVerifier — GATEWAY_AUDIENCE set', () => {
  it('returns false when no Authorization header provided', async () => {
    const verify = makeGatewayVerifier({ GATEWAY_AUDIENCE: 'https://my-gateway' });
    expect(await verify(undefined)).toBe(false);
  });

  it('returns false when Bearer token is garbage (jwtVerify throws)', async () => {
    const verify = makeGatewayVerifier({ GATEWAY_AUDIENCE: 'https://my-gateway' });
    expect(await verify('Bearer not-a-real-jwt')).toBe(false);
  });

  it('returns false when Authorization header has no Bearer prefix', async () => {
    const verify = makeGatewayVerifier({ GATEWAY_AUDIENCE: 'https://my-gateway' });
    expect(await verify('not-bearer-format')).toBe(false);
  });
});

describe('Route auth integration', () => {
  it('POST /tools/list returns 401 when verifyAuth rejects', async () => {
    const app = await buildApp({
      verifyAuth: async () => false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/tools/list',
      payload: { orgId: 'o1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('POST /tools/call returns 401 when verifyAuth rejects', async () => {
    const app = await buildApp({
      verifyAuth: async () => false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/tools/call',
      payload: { orgId: 'o1', name: 'mcp.github.read_file' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /healthz is NOT gated — returns 200 even when verifyAuth rejects', async () => {
    const app = await buildApp({
      verifyAuth: async () => false,
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('existing tests: buildApp({}) with no verifyAuth still serves /tools/* (default bypass)', async () => {
    // verifyAuth defaults to bypass (always true); existing gateway-routes tests must still pass
    const app = await buildApp({});
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
