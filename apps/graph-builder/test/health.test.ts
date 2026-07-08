import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

const JOB = { orgId: '00000000-0000-0000-0000-000000000000', repoFullName: 'a/b', ref: 'main', mode: 'manual' };
const PROJECT_JOB = { orgId: '00000000-0000-0000-0000-000000000000', projectId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', repoFullName: '(project)', mode: 'manual', buildId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', phase: 'structure' };
// Wrap a job exactly as a Pub/Sub push subscription delivers it.
const push = (payload: unknown) => ({ message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') } });

describe('graph-builder app', () => {
  it('healthz returns ok', async () => {
    const app = await buildApp({ verifyServiceAuth: async () => true });
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
  it('build route 401s without service auth', async () => {
    const app = await buildApp({}); // no verifier → default deny
    const res = await app.inject({ method: 'POST', url: '/api/internal/build', payload: push(JOB) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it('build route decodes a Pub/Sub push envelope and calls onBuild', async () => {
    let got: any = null;
    const app = await buildApp({ verifyServiceAuth: async () => true, onBuild: async (j) => { got = j; } });
    const res = await app.inject({ method: 'POST', url: '/api/internal/build', payload: push(JOB) });
    expect(res.statusCode).toBe(202);
    expect(got).toMatchObject({ repoFullName: 'a/b', mode: 'manual' });
    await app.close();
  });
  it('ack-drops a non-envelope body without calling onBuild', async () => {
    let called = false;
    const app = await buildApp({ verifyServiceAuth: async () => true, onBuild: async () => { called = true; } });
    // A raw job (no Pub/Sub envelope) is a malformed delivery → 200 drop, not an infinite-retry 400.
    const res = await app.inject({ method: 'POST', url: '/api/internal/build', payload: JOB });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dropped: 'envelope' });
    expect(called).toBe(false);
    await app.close();
  });
  it('ack-drops an envelope whose payload fails the schema', async () => {
    let called = false;
    const app = await buildApp({ verifyServiceAuth: async () => true, onBuild: async () => { called = true; } });
    const res = await app.inject({ method: 'POST', url: '/api/internal/build', payload: push({ repoFullName: 'a/b' }) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dropped: 'schema' });
    expect(called).toBe(false);
    await app.close();
  });
  it('accepts a project-level build envelope with no ref and calls onBuild', async () => {
    let got: any = null;
    const app = await buildApp({ verifyServiceAuth: async () => true, onBuild: async (j) => { got = j; } });
    const res = await app.inject({ method: 'POST', url: '/api/internal/build', payload: push(PROJECT_JOB) });
    expect(res.statusCode).toBe(202);
    expect(got).toMatchObject({ projectId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', repoFullName: '(project)', phase: 'structure' });
    expect(got.ref).toBeUndefined();
    await app.close();
  });
});
