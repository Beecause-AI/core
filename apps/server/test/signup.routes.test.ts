import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getOrgBySlug, listOrgMembers, setOrgIdpTenant } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { startTestDb, testConfig, fakeIdpAdmin, fakeEmail } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let idp: ReturnType<typeof fakeIdpAdmin>;
let email: ReturnType<typeof fakeEmail>;

beforeAll(async () => {
  t = await startTestDb();
  idp = fakeIdpAdmin();
  email = fakeEmail();
  app = await buildApp({ db: t.db, store: t.store, config: testConfig, idpAdmin: idp.api, email: email.api });
});
afterAll(async () => { await app.close(); await t.stop(); });

// The limiter keys on req.ip; each test uses a DISTINCT remoteAddress so buckets
// never collide across tests (the app/fakes are shared for the whole file).
function signup(
  payload: { orgName: string; slug: string; email: string; name: string },
  ip: string,
) {
  return app.inject({ method: 'POST', url: '/api/auth/signup', remoteAddress: ip, payload });
}

async function tokenFor(slug: string, em: string, name: string) {
  const { createVerifyToken } = await import('../src/auth/session.js');
  return createVerifyToken({ slug, email: em, name }, testConfig.SESSION_SECRET);
}

describe('POST /api/auth/signup (pending-org model)', () => {
  it('creates a PENDING org, touches no Identity Platform state, and emails a verify link', async () => {
    const res = await signup({ orgName: 'Acme Corp', slug: 'acme-corp', email: 'new@x.dev', name: 'New User' }, '1.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(idp.tenants.size).toBe(0); // no tenant, no user before verification
    const org = await getOrgBySlug(t.db, 'acme-corp');
    expect(org).not.toBeNull();
    expect(org!.status).toBe('pending');
    expect(org!.pendingEmail).toBe('new@x.dev');
    const mail = email.sent.find((m) => m.to === 'new@x.dev');
    expect(mail?.html).toContain('/verify?token=');
    const members = await listOrgMembers(t.db, org!.id);
    expect(members).toHaveLength(0); // owner is added at completion
  });

  it('active slug → 409', async () => {
    const liveId = randomUUID();
    await t.store.db.collection('organizations').doc(liveId).set({ id: liveId, name: 'Live', slug: 'live-org', status: 'active', createdAt: new Date() });
    const res = await signup({ orgName: 'X', slug: 'live-org', email: 'x@x.dev', name: 'X' }, '1.0.0.2');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/taken/i);
  });

  it('fresh pending slug + DIFFERENT email → 409 (no takeover before expiry)', async () => {
    await signup({ orgName: 'P', slug: 'pending-held', email: 'a@x.dev', name: 'A' }, '1.0.0.3');
    const res = await signup({ orgName: 'P2', slug: 'pending-held', email: 'b@x.dev', name: 'B' }, '1.0.0.4');
    expect(res.statusCode).toBe(409);
  });

  it('fresh pending slug + SAME email → 200 resend (one org row, one more email)', async () => {
    await signup({ orgName: 'R', slug: 'resend-org', email: 'r@x.dev', name: 'R' }, '1.0.0.5');
    const before = email.sent.filter((m) => m.to === 'r@x.dev').length;
    const res = await signup({ orgName: 'R', slug: 'resend-org', email: 'r@x.dev', name: 'R' }, '1.0.0.6');
    expect(res.statusCode).toBe(200);
    expect(email.sent.filter((m) => m.to === 'r@x.dev').length).toBe(before + 1);
    const org = await getOrgBySlug(t.db, 'resend-org');
    expect(org).not.toBeNull();
  });

  it('STALE pending slug (>7d) is reclaimed by a new signup', async () => {
    await signup({ orgName: 'Old', slug: 'stale-org', email: 'old@x.dev', name: 'O' }, '1.0.0.7');
    const stale = await getOrgBySlug(t.db, 'stale-org');
    await t.store.db.collection('organizations').doc(stale!.id)
      .update({ createdAt: new Date(Date.now() - 8 * 24 * 3600_000) });
    const res = await signup({ orgName: 'New', slug: 'stale-org', email: 'new2@x.dev', name: 'N' }, '1.0.0.8');
    expect(res.statusCode).toBe(200);
    const org = await getOrgBySlug(t.db, 'stale-org');
    expect(org).not.toBeNull();
    expect(org!.pendingEmail).toBe('new2@x.dev');
  });

  it('suppresses the verify email for @e2e.beecause.ai addresses (prod E2E identities)', async () => {
    const res = await signup({ orgName: 'E2E Co', slug: 'e2e-suppress', email: 'e2e-x@e2e.beecause.ai', name: 'E' }, '1.0.0.30');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).token).toBeUndefined(); // no dev-token backdoor in prod mode
    expect(email.sent.filter((m) => m.to.endsWith('@e2e.beecause.ai'))).toHaveLength(0);
    // the pending org still exists — the E2E runner mints the verify token itself
    const org = await getOrgBySlug(t.db, 'e2e-suppress');
    expect(org?.status).toBe('pending');
  });

  it('suppresses the resend too for @e2e.beecause.ai addresses', async () => {
    const res = await signup({ orgName: 'E2E Co', slug: 'e2e-suppress', email: 'e2e-x@e2e.beecause.ai', name: 'E' }, '1.0.0.31');
    expect(res.statusCode).toBe(200); // same-signer resend path
    expect(email.sent.filter((m) => m.to.endsWith('@e2e.beecause.ai'))).toHaveLength(0);
  });

  it("reserved slug 'master' → 400 (realm-name collision)", async () => {
    const res = await signup({ orgName: 'M', slug: 'master', email: 'm@x.dev', name: 'M' }, '1.0.0.9');
    expect(res.statusCode).toBe(400);
  });

  it("reserved slug 'e2e' → 400 (collides with the E2E email domain host)", async () => {
    const res = await signup({ orgName: 'E', slug: 'e2e', email: 'e@x.dev', name: 'E' }, '1.0.0.32');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/reserved/i);
  });

  it('rejects a reserved slug with 400', async () => {
    const res = await signup({ orgName: 'App Inc', slug: 'app', email: 'app@x.dev', name: 'App' }, '1.0.0.10');
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error ?? JSON.stringify(body)).toMatch(/reserved/i);
  });

  it('rejects an invalid slug (uppercase) with 400', async () => {
    const res = await signup({ orgName: 'Bad', slug: 'BadSlug', email: 'bad@x.dev', name: 'Bad' }, '1.0.0.21');
    expect(res.statusCode).toBe(400);
  });

  it('rejects a trailing-hyphen slug with 400', async () => {
    const res = await signup({ orgName: 'Bad Hyphen', slug: 'my-ws-', email: 'badhyphen@x.dev', name: 'Bad' }, '1.0.0.22');
    expect(res.statusCode).toBe(400);
  });

  it('accepts a valid 2-char alphanumeric slug', async () => {
    const res = await signup({ orgName: 'Short', slug: 'ab', email: 'short@x.dev', name: 'Short' }, '1.0.0.23');
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing orgName with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup', remoteAddress: '1.0.0.20',
      payload: { slug: 'no-org', email: 'noorg@x.dev', name: 'N' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate-limits repeated signups from one IP (429), keyed on req.ip', async () => {
    for (let i = 0; i < 5; i++) {
      await signup({ orgName: `R${i}`, slug: `rate-slug-${i}`, email: `r${i}@x.dev`, name: 'R' }, '7.7.7.7');
    }
    const res = await signup({ orgName: 'R9', slug: 'rate-slug-9', email: 'r9@x.dev', name: 'R' }, '7.7.7.7');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('forged cf-connecting-ip does not bypass the limiter (keyed on socket, not the CF header)', async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST', url: '/api/auth/signup', remoteAddress: '8.8.8.8',
        headers: { 'cf-connecting-ip': `10.0.0.${i}` },
        payload: { orgName: `F${i}`, slug: `forge-slug-${i}`, email: `f${i}@x.dev`, name: 'F' },
      });
    }
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup', remoteAddress: '8.8.8.8',
      headers: { 'cf-connecting-ip': '10.0.0.99' },
      payload: { orgName: 'F9', slug: 'forge-slug-9', email: 'f9@x.dev', name: 'F' },
    });
    expect(res.statusCode).toBe(429);
  });
});

describe('POST /api/auth/complete', () => {
  it('provisions tenant + verified user + owner membership and activates the org', async () => {
    await signup({ orgName: 'Comp Co', slug: 'comp-co', email: 'c@x.dev', name: 'C' }, '3.0.0.1');
    const mail = email.sent.find((m) => m.to === 'c@x.dev');
    const token = decodeURIComponent(mail!.html.match(/\/verify\?token=([^"&\s]+)/)![1]!);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.0.2',
      payload: { token, password: 'longenough12' },
    });
    expect(res.statusCode).toBe(200);
    // Straight into the workspace — no manual first login after activation.
    expect(JSON.parse(res.body).redirect).toBe('https://comp-co.beecause.ai/');

    // The response mints the app session for the just-created (verified) user.
    const { verifySessionToken } = await import('../src/auth/session.js');
    const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const sessionCookie = setCookies.find((c) => c.startsWith('__session='));
    expect(sessionCookie).toBeDefined();
    const jwt = sessionCookie!.split(';')[0]!.slice('__session='.length);
    const user = await verifySessionToken(jwt, testConfig.SESSION_SECRET);
    expect(user?.email).toBe('c@x.dev');
    expect(user?.idt).toBeUndefined(); // no SSO behind this session

    // org activated with a persisted Identity Platform tenant
    const org = await getOrgBySlug(t.db, 'comp-co');
    expect(org!.status).toBe('active');
    expect(org!.pendingEmail).toBeNull();
    expect(org!.idpTenantId).toBeTruthy();

    // user exists in the org tenant, born verified
    const u = [...idp.tenants.get(org!.idpTenantId!)!.values()].find((x) => x.email === 'c@x.dev')!;
    expect(u.emailVerified).toBe(true);

    // owner membership + users row
    const members = await listOrgMembers(t.db, org!.id);
    expect(members).toEqual([expect.objectContaining({ userId: u.uid, role: 'owner' })]);
    const userSnap = await t.store.db.collection('users').doc(u.uid).get();
    expect(userSnap.data()?.email).toBe('c@x.dev');
  });

  it('is idempotent: re-posting the same token returns the redirect without duplicating anything', async () => {
    await signup({ orgName: 'Twice', slug: 'twice-co', email: 't@x.dev', name: 'T' }, '3.0.1.1');
    const token = await tokenFor('twice-co', 't@x.dev', 'T');
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.1.2', payload: { token, password: 'longenough12' } });
    expect(r1.statusCode).toBe(200);
    const tenantsBefore = idp.tenants.size;
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.1.3', payload: { token, password: 'longenough12' } });
    expect(r2.statusCode).toBe(200);
    expect(JSON.parse(r2.body).redirect).toContain('twice-co.');
    expect(idp.tenants.size).toBe(tenantsBefore); // active org short-circuits before any IdP call
    // Link re-use must NOT mint a session — only the run that performs activation does.
    const r2Cookies = ([] as string[]).concat(r2.headers['set-cookie'] ?? []);
    expect(r2Cookies.find((c) => c.startsWith('__session='))).toBeUndefined();
    const org = await getOrgBySlug(t.db, 'twice-co');
    const members = await listOrgMembers(t.db, org!.id);
    expect(members).toHaveLength(1);
  });

  it('resumes a half-finished provisioning run (tenant already created, org still pending)', async () => {
    await signup({ orgName: 'Resume', slug: 'resume-co', email: 'rz@x.dev', name: 'R' }, '3.0.2.1');
    // simulate a previous crash: tenant created + persisted, but nothing after
    const pending = await getOrgBySlug(t.db, 'resume-co');
    const { tenantId } = await idp.api.createTenant({ displayName: 'Resume' });
    await setOrgIdpTenant(t.db, pending!.id, tenantId);
    const token = await tokenFor('resume-co', 'rz@x.dev', 'R');
    const res = await app.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.2.2', payload: { token, password: 'longenough12' } });
    expect(res.statusCode).toBe(200);
    const org = await getOrgBySlug(t.db, 'resume-co');
    expect(org!.status).toBe('active');
    expect(org!.idpTenantId).toBe(tenantId); // reused, NOT re-created
    expect([...idp.tenants.get(tenantId)!.values()].some((u) => u.email === 'rz@x.dev')).toBe(true);
  });

  it('503 when idpAdmin is absent', async () => {
    const noIdpApp = await buildApp({ db: t.db, store: t.store, config: testConfig, email: email.api });
    const token = await tokenFor('any-co', 'a@x.dev', 'A');
    const res = await noIdpApp.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.6.1', payload: { token, password: 'longenough12' } });
    expect(res.statusCode).toBe(503);
    await noIdpApp.close();
  });

  it('rejects a garbage token with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.3.1', payload: { token: 'garbage', password: 'longenough12' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a valid token whose pending org no longer exists with 400', async () => {
    const token = await tokenFor('never-created', 'n@x.dev', 'N');
    const res = await app.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.4.1', payload: { token, password: 'longenough12' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a short password with 400', async () => {
    await signup({ orgName: 'PwCo', slug: 'pw-co', email: 'pw@x.dev', name: 'P' }, '3.0.5.1');
    const token = await tokenFor('pw-co', 'pw@x.dev', 'P');
    const res = await app.inject({ method: 'POST', url: '/api/auth/complete', remoteAddress: '3.0.5.2', payload: { token, password: 'short' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/signup with AUTO_VERIFY_EMAIL=true', () => {
  let avApp: FastifyInstance;
  let avIdp: ReturnType<typeof fakeIdpAdmin>;
  let avEmail: ReturnType<typeof fakeEmail>;
  let avT: Awaited<ReturnType<typeof startTestDb>>;

  beforeAll(async () => {
    avT = await startTestDb();
    avIdp = fakeIdpAdmin();
    avEmail = fakeEmail();
    avApp = await buildApp({
      db: avT.db, store: avT.store,
      config: { ...testConfig, AUTO_VERIFY_EMAIL: true },
      idpAdmin: avIdp.api,
      email: avEmail.api,
    });
  });
  afterAll(async () => { await avApp.close(); await avT.stop(); });

  it('returns the verify token instead of sending email (dev shortcut)', async () => {
    const res = await avApp.inject({
      method: 'POST', url: '/api/auth/signup', remoteAddress: '2.0.0.1',
      payload: { orgName: 'Dev Corp', slug: 'dev-corp', email: 'dev@x.dev', name: 'Dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).token).toBeTruthy();
    expect(avEmail.sent).toHaveLength(0);
    expect(avIdp.tenants.size).toBe(0); // still pending — completion happens via /complete
  });
});
