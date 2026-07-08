import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrgOwner, createPendingOrg } from '@intellilabs/core';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { buildApp } from '../src/app.js';
import { slugFromHost } from '../src/auth/org-context.js';
import { startTestDb, testConfig } from './helpers.js';

describe('slugFromHost', () => {
  it('extracts the org slug from a slug host', () => {
    expect(slugFromHost('acme.beecause.ai', 'beecause.ai')).toBe('acme');
  });
  it('returns null for apex and reserved app hosts', () => {
    expect(slugFromHost('beecause.ai', 'beecause.ai')).toBeNull();
    expect(slugFromHost('app.beecause.ai', 'beecause.ai')).toBeNull();
    expect(slugFromHost('www.beecause.ai', 'beecause.ai')).toBeNull();
  });
  it('returns null for foreign hosts and multi-label subdomains', () => {
    expect(slugFromHost('evil.com', 'beecause.ai')).toBeNull();
    expect(slugFromHost('a.b.beecause.ai', 'beecause.ai')).toBeNull();
  });
  it('handles a forwarded host with comma list / port', () => {
    expect(slugFromHost('acme.beecause.ai:443', 'beecause.ai')).toBe('acme');
  });
});

describe('resolveOrg', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    t = await startTestDb();
    app = await buildApp({ db: t.db, store: t.store, config: testConfig });
  });
  afterAll(async () => { await app.close(); await t.stop(); });

  it('404s for a PENDING org host (realm not yet provisioned)', async () => {
    // The session user IS an owner — the 404 must come from resolveOrg's status
    // gate, not from the membership guard.
    const org = await createPendingOrg(t.db, { name: 'Pend', slug: 'pend-host', email: 'p@x.dev' });
    await addOrgOwner(t.db, org.id, 'u-any');
    const cookie = await createSessionToken({ sub: 'u-any' }, testConfig.SESSION_SECRET);
    const res = await app.inject({
      method: 'GET', url: '/api/org',
      headers: { 'x-forwarded-host': 'pend-host.beecause.ai' },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
