import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createOrgWithOwner, activateOrg, createPendingOrg } from '@intellilabs/core';
import { subdomainTenantResolver, singleTenantResolver } from '../src/auth/tenant-resolver.js';
import { startTestDb } from './helpers.js';

// ---------------------------------------------------------------------------
// singleTenantResolver
// ---------------------------------------------------------------------------
describe('singleTenantResolver', () => {
  it('returns the loaded org regardless of host', async () => {
    const org = { id: 'o1', name: 'OSS', slug: 'default', status: 'active' } as any;
    const resolver = singleTenantResolver(async () => org);
    // host is irrelevant — pass a fake request with any header
    const fakeReq = { headers: { 'x-forwarded-host': 'anything.example.com' } } as unknown as FastifyRequest;
    const result = await resolver.resolve(fakeReq);
    expect(result).toEqual({ org });
  });

  it('returns not-found when the load returns null', async () => {
    const resolver = singleTenantResolver(async () => null);
    const fakeReq = { headers: {} } as unknown as FastifyRequest;
    const result = await resolver.resolve(fakeReq);
    expect(result).toEqual({ error: 'not-found' });
  });
});

// ---------------------------------------------------------------------------
// subdomainTenantResolver
// ---------------------------------------------------------------------------
describe('subdomainTenantResolver', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;

  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await t.stop(); });

  function makeReq(forwardedHost: string | undefined): FastifyRequest {
    return { headers: { 'x-forwarded-host': forwardedHost } } as unknown as FastifyRequest;
  }

  it('returns no-host for apex host (no org subdomain)', async () => {
    const resolver = subdomainTenantResolver({ db: t.db, baseUrl: 'https://beecause.ai' });
    const result = await resolver.resolve(makeReq('beecause.ai'));
    expect(result).toEqual({ error: 'no-host' });
  });

  it('returns no-host when x-forwarded-host is absent', async () => {
    const resolver = subdomainTenantResolver({ db: t.db, baseUrl: 'https://beecause.ai' });
    const result = await resolver.resolve(makeReq(undefined));
    expect(result).toEqual({ error: 'no-host' });
  });

  it('returns not-found for an unknown slug', async () => {
    const resolver = subdomainTenantResolver({ db: t.db, baseUrl: 'https://beecause.ai' });
    const result = await resolver.resolve(makeReq('unknown-slug.beecause.ai'));
    expect(result).toEqual({ error: 'not-found' });
  });

  it('returns the org for a known active org slug', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'ACME', slug: 'acme-tr', userId: 'u-owner' });
    await activateOrg(t.db, org.id);
    const resolver = subdomainTenantResolver({ db: t.db, baseUrl: 'https://beecause.ai' });
    const result = await resolver.resolve(makeReq('acme-tr.beecause.ai'));
    expect('org' in result).toBe(true);
    if ('org' in result) expect(result.org.id).toBe(org.id);
  });

  it('returns not-found for a pending (non-active) org', async () => {
    // createPendingOrg creates a pending org (status='pending', no owner member)
    const org = await createPendingOrg(t.db, { name: 'Pending', slug: 'pending-tr', email: 'p@p.dev' });
    void org; // it exists but not activated
    const resolver = subdomainTenantResolver({ db: t.db, baseUrl: 'https://beecause.ai' });
    const result = await resolver.resolve(makeReq('pending-tr.beecause.ai'));
    expect(result).toEqual({ error: 'not-found' });
  });
});
