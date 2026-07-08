import { describe, expect, it } from 'vitest';
import fastify from 'fastify';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { requireSessionUser } from '../src/auth/session-guard.js';

const SECRET = 'x'.repeat(40);
function app() {
  const a = fastify();
  a.decorate('config', { SESSION_SECRET: SECRET } as any);
  a.decorateRequest('user', null);
  a.get('/p', { preHandler: requireSessionUser }, async (req) => ({ sub: (req as any).user?.sub }));
  return a;
}

describe('requireSessionUser', () => {
  it('accepts a valid session cookie', async () => {
    const a = app();
    const token = await createSessionToken({ sub: 'u1' }, SECRET);
    const res = await a.inject({ method: 'GET', url: '/p', headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sub).toBe('u1');
    await a.close();
  });
  it('rejects an API-key Authorization header (no cookie) with 401', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/p', headers: { authorization: 'Bearer ilk_whatever' } });
    expect(res.statusCode).toBe(401);
    await a.close();
  });
  it('rejects no auth with 401', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/p' })).statusCode).toBe(401);
    await a.close();
  });
  it('rejects a tampered/garbage cookie value with 401', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET',
      url: '/p',
      headers: { cookie: `${SESSION_COOKIE}=not-a-valid-token` },
    });
    expect(res.statusCode).toBe(401);
    await a.close();
  });
});
