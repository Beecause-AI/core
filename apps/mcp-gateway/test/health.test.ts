import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /healthz', () => {
  it('returns 200 { ok: true }', async () => {
    const app = await buildApp({});
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
