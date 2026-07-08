import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createInvitation, setOrgIdpTenant, upsertUser, listPendingInvitations, getMembership } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createInviteToken, createSessionToken, verifySessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig, fakeIdpAdmin, fakeEmail } from './helpers.js';

const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let idp: ReturnType<typeof fakeIdpAdmin>;
let email: ReturnType<typeof fakeEmail>;
let orgId: string;
let tenantId: string;
let cookieOwner: Record<string, string>;
let cookieManager: Record<string, string>;
let cookieUser: Record<string, string>;

// The limiter keys on req.ip; each test uses a DISTINCT remoteAddress so buckets
// never collide across tests (the app/fakes are shared for the whole file).
function invite(payload: Record<string, string>, cookies: Record<string, string>, ip: string) {
  return app.inject({ method: 'POST', url: '/api/org/invitations', remoteAddress: ip, cookies, headers: ACM_HOST, payload });
}
function accept(payload: Record<string, string>, ip: string) {
  return app.inject({ method: 'POST', url: '/api/auth/accept-invite', remoteAddress: ip, payload });
}
const tokenFrom = (to: string) => {
  const mail = email.sent.find((m) => m.to === to);
  return mail ? decodeURIComponent(mail.html.match(/\/accept-invite\?token=([^"&\s]+)/)![1]!) : null;
};

beforeAll(async () => {
  t = await startTestDb();
  idp = fakeIdpAdmin();
  email = fakeEmail();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, idpAdmin: idp.api, email: email.api });

  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  orgId = org.id;
  // The org's Identity Platform tenant exists once the org is active.
  ({ tenantId } = await idp.api.createTenant({ displayName: 'Acme' }));
  await setOrgIdpTenant(t.db, orgId, tenantId);
  for (const m of [{ userId: 'u-mgr', role: 'manager' }, { userId: 'u-plain', role: 'user' }]) {
    const mid = `${orgId}_${m.userId}`;
    await t.store.db.collection('org_members').doc(mid).set({ id: mid, orgId, userId: m.userId, role: m.role, createdAt: new Date() });
  }
  await upsertUser(t.db, { userId: 'u-owner', email: 'owner@x.dev' });
  await upsertUser(t.db, { userId: 'u-plain', email: 'plain@x.dev' });
  cookieOwner = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-owner', email: 'owner@x.dev' }, testConfig.SESSION_SECRET) };
  cookieManager = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-mgr', email: 'mgr@x.dev' }, testConfig.SESSION_SECRET) };
  cookieUser = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u-plain', email: 'plain@x.dev' }, testConfig.SESSION_SECRET) };
});
afterAll(async () => { await app.close(); await t.stop(); });

describe('GET /api/org/invitations', () => {
  it('404s for a plain user (admin-only, existence-hiding)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/invitations', cookies: cookieUser, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });

  it('lists pending invitations for an admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/invitations', cookies: cookieManager, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/org/invitations', () => {
  it('owner invites a user → 200 + invite email with an org-host accept link', async () => {
    const res = await invite({ email: 'New.Member@X.dev', role: 'user' }, cookieOwner, '11.0.0.1');
    expect(res.statusCode).toBe(200);
    const mail = email.sent.find((m) => m.to === 'new.member@x.dev');
    expect(mail?.html).toContain('https://acme.beecause.ai/accept-invite?token=');
    expect(mail?.html).toContain('owner@x.dev'); // inviter shown
    const rows = await listPendingInvitations(t.db, orgId);
    expect(rows.some((r) => r.email === 'new.member@x.dev' && r.role === 'user' && r.status === 'pending')).toBe(true);
  });

  it('manager invites a user → 200', async () => {
    const res = await invite({ email: 'by-manager@x.dev', role: 'user' }, cookieManager, '11.0.0.2');
    expect(res.statusCode).toBe(200);
  });

  it('manager inviting a MANAGER → 403 (owner-only, mirrors owner-touching PATCH rule)', async () => {
    const res = await invite({ email: 'mgr2@x.dev', role: 'manager' }, cookieManager, '11.0.0.3');
    expect(res.statusCode).toBe(403);
  });

  it('owner inviting a manager → 200', async () => {
    const res = await invite({ email: 'mgr2@x.dev', role: 'manager' }, cookieOwner, '11.0.0.4');
    expect(res.statusCode).toBe(200);
  });

  it("inviting role 'owner' → 400 (not an invitable role)", async () => {
    const res = await invite({ email: 'newowner@x.dev', role: 'owner' }, cookieOwner, '11.0.0.5');
    expect(res.statusCode).toBe(400);
  });

  it('plain user → 404', async () => {
    const res = await invite({ email: 'whoever@x.dev', role: 'user' }, cookieUser, '11.0.0.6');
    expect(res.statusCode).toBe(404);
  });

  it('inviting an existing member → 422', async () => {
    const res = await invite({ email: 'plain@x.dev', role: 'user' }, cookieOwner, '11.0.0.7');
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/already a member/);
  });

  it('duplicate pending invite → 422', async () => {
    const res = await invite({ email: 'new.member@x.dev', role: 'user' }, cookieOwner, '11.0.0.8');
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/already invited/);
  });

  it('suppresses the email for @e2e.beecause.ai invitees', async () => {
    const res = await invite({ email: 'inv@e2e.beecause.ai', role: 'user' }, cookieOwner, '11.0.0.9');
    expect(res.statusCode).toBe(200);
    expect(email.sent.filter((m) => m.to.endsWith('@e2e.beecause.ai'))).toHaveLength(0);
  });

  it('rate-limits per IP → 429', async () => {
    for (let i = 0; i < 5; i++) await invite({ email: `rl${i}@x.dev`, role: 'user' }, cookieOwner, '9.9.9.9');
    const res = await invite({ email: 'rl9@x.dev', role: 'user' }, cookieOwner, '9.9.9.9');
    expect(res.statusCode).toBe(429);
  });
});

describe('DELETE /api/org/invitations/:id', () => {
  it('revokes a pending invite (204), 404s the second time, and the emailed link dies', async () => {
    await invite({ email: 'revoke-me@x.dev', role: 'user' }, cookieOwner, '12.0.0.1');
    const token = tokenFrom('revoke-me@x.dev')!;
    const pending = await listPendingInvitations(t.db, orgId);
    const inv = pending.find((r) => r.email === 'revoke-me@x.dev');

    const res = await app.inject({ method: 'DELETE', url: `/api/org/invitations/${inv!.id}`, cookies: cookieOwner, headers: ACM_HOST });
    expect(res.statusCode).toBe(204);
    const again = await app.inject({ method: 'DELETE', url: `/api/org/invitations/${inv!.id}`, cookies: cookieOwner, headers: ACM_HOST });
    expect(again.statusCode).toBe(404);

    // clicking the revoked link answers the uniform 'expired'
    const acc = await accept({ token, password: 'longenough12' }, '12.0.0.2');
    expect(acc.statusCode).toBe(400);
    expect(acc.json().error).toBe('expired');
  });

  it('404s for a plain user', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/org/invitations/00000000-0000-0000-0000-000000000001', cookies: cookieUser, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/auth/accept-invite', () => {
  it('new invitee: creates the IdP user in the org tenant, adds membership, auto-logs-in', async () => {
    const token = tokenFrom('new.member@x.dev')!;
    const res = await accept({ token, password: 'longenough12' }, '13.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(res.json().redirect).toBe('https://acme.beecause.ai/');

    const idpUser = [...idp.tenants.get(tenantId)!.values()].find((u) => u.email === 'new.member@x.dev')!;
    expect(idpUser.emailVerified).toBe(true);

    const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const sessionCookie = setCookies.find((c) => c.startsWith('__session='))!;
    const jwt = sessionCookie.split(';')[0]!.slice('__session='.length);
    const user = await verifySessionToken(jwt, testConfig.SESSION_SECRET);
    expect(user?.sub).toBe(idpUser.uid);

    const member = await getMembership(t.db, orgId, idpUser.uid);
    expect(member).toMatchObject({ orgId, role: 'user' });
    const invSnap = await t.store.db.collection('org_invitations').where('email', '==', 'new.member@x.dev').get();
    expect(invSnap[0]!.data()?.status).toBe('accepted');
  });

  it('re-clicking a redeemed link → 400 expired (no second session)', async () => {
    const token = tokenFrom('new.member@x.dev')!;
    const res = await accept({ token, password: 'longenough12' }, '13.0.1.1');
    expect(res.statusCode).toBe(400);
  });

  it('invitee with an existing IdP account joins WITHOUT a password (keeps their password)', async () => {
    // mgr2@x.dev already has an IdP user in the tenant (e.g. removed & re-invited)
    const existing = await idp.api.createUser(tenantId, { email: 'mgr2@x.dev', password: 'their-old-pass', name: 'M', emailVerified: true });
    const token = tokenFrom('mgr2@x.dev')!;
    const res = await accept({ token }, '13.0.2.1');
    expect(res.statusCode).toBe(200);
    const member = await getMembership(t.db, orgId, existing.uid);
    expect(member).toMatchObject({ orgId, role: 'manager' }); // invited role applied
  });

  it('new invitee without a password → 400', async () => {
    await invite({ email: 'no-pass@x.dev', role: 'user' }, cookieOwner, '13.0.3.0');
    const token = tokenFrom('no-pass@x.dev')!;
    const res = await accept({ token }, '13.0.3.1');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/password/);
  });

  it('garbage token → 400 expired', async () => {
    const res = await accept({ token: 'garbage', password: 'longenough12' }, '13.0.4.1');
    expect(res.statusCode).toBe(400);
  });

  it('valid JWT whose DB row is past expiresAt → 400, member NOT added', async () => {
    const inv = await createInvitation(t.db, {
      orgId, email: 'too-late@x.dev', role: 'user', invitedBy: 'u-owner',
      expiresAt: new Date(Date.now() - 1000),
    });
    const token = await createInviteToken({ slug: 'acme', email: 'too-late@x.dev', invitationId: inv.id }, testConfig.SESSION_SECRET);
    const res = await accept({ token, password: 'longenough12' }, '13.0.5.1');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('expired');
  });
});

describe('AUTO_VERIFY_EMAIL=true', () => {
  it('returns the invite token inline instead of emailing', async () => {
    const avApp = await buildApp({ db: t.db, store: t.store, config: { ...testConfig, AUTO_VERIFY_EMAIL: true }, idpAdmin: idp.api, email: email.api });
    const res = await avApp.inject({
      method: 'POST', url: '/api/org/invitations', remoteAddress: '14.0.0.1',
      cookies: cookieOwner, headers: ACM_HOST, payload: { email: 'inline@x.dev', role: 'user' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
    expect(email.sent.find((m) => m.to === 'inline@x.dev')).toBeUndefined();
    await avApp.close();
  });
});
