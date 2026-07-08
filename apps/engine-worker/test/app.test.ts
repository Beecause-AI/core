import { describe, expect, it } from 'vitest';
import { buildWorkerApp } from '../src/app.js';

describe('engine worker app', () => {
  it('serves /api/healthz', async () => {
    const app = await buildWorkerApp({ engine: null, verify: async () => false });
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
  it('does NOT register /api/internal/run-turn when engine is absent', async () => {
    const app = await buildWorkerApp({ engine: null, verify: async () => false });
    const res = await app.inject({ method: 'POST', url: '/api/internal/run-turn', payload: {} });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
