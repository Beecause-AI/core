import { test, expect, type Page, type Browser } from '@playwright/test';

// Org-member invitation journey on a freshly founded org:
//   found org via API (AUTO_VERIFY_EMAIL hands tokens back inline) → owner logs
//   in → /admin/members (left-menu panel) → invite a user → invitee opens the
//   accept link, sets a password, lands auto-logged-in as role 'user' →
//   revoked invitations answer the uniform expired screen → plain users get
//   neither the Admin link nor the panel.
//
// NO EMAILS: same regime as signup-flow (no RESEND_API_KEY + AUTO_VERIFY_EMAIL).

const ts = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const slug = `e2e-inv-${ts}`;
const ownerEmail = `e2e-inv-owner-${ts}@example.test`;
const inviteeEmail = `e2e-invitee-${ts}@example.test`;
const password = 'e2e-Sup3r-secret!';
const inviteePassword = 'e2e-1nv1tee-secret!';

const WORKSPACE = `http://${slug}.localhost:3000`;
const MARKETING = 'http://localhost:3001';

async function loginViaKeycloak(page: Page, email: string, pass: string) {
  await page.waitForURL(new RegExp(`/realms/${slug}/protocol/openid-connect/auth`), { timeout: 60_000 });
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(pass);
  await page.locator('button[type="submit"], #kc-login').first().click();
  await page.waitForURL(new RegExp(`http://${slug}\\.localhost:3000/`), { timeout: 60_000 });
}

async function ownerPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${WORKSPACE}/auth/login`);
  await loginViaKeycloak(page, ownerEmail, password);
  return page;
}

test.beforeAll(async ({ request }) => {
  // Found the org through the API — this suite is about invitations, not signup.
  const signup = await request.post(`${MARKETING}/api/auth/signup`, {
    data: { orgName: `E2E Inv ${ts}`, slug, email: ownerEmail, name: 'Inv Owner' },
  });
  // 409 = a previous worker (restarted after a test failure) already founded
  // this run's org — beforeAll re-runs per worker, so it must be re-entrant.
  if (signup.status() === 409) return;
  expect(signup.status()).toBe(200);
  const { token } = (await signup.json()) as { token: string };
  const complete = await request.post(`${MARKETING}/api/auth/complete`, {
    data: { token, password },
  });
  expect(complete.status()).toBe(200);
});

test('owner invites a user through /admin/members and the invitee joins via the accept link', async ({ browser }) => {
  const page = await ownerPage(browser);

  // The dashboard's left menu carries the Admin section for owners/managers.
  await expect(page.getByRole('link', { name: 'All projects' })).toBeVisible();
  await expect(page.getByText('Admin', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Members' }).click();
  await page.waitForURL(`${WORKSPACE}/admin/members`);

  // Same unified menu on the admin page, members list with the founder.
  await expect(page.getByRole('link', { name: 'Members' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByText('owner', { exact: true })).toBeVisible();

  // Invite through the real form; AUTO_VERIFY_EMAIL returns the accept token in
  // the API response — capture it as the stand-in for the emailed link.
  const tokenPromise = page
    .waitForResponse((r) => r.url().endsWith('/api/org/invitations') && r.request().method() === 'POST')
    .then(async (r) => ((await r.json()) as { token: string }).token);
  await page.getByPlaceholder('colleague@company.com').fill(inviteeEmail);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invitation sent to ${inviteeEmail}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();
  // exact: the "Invitation sent to …" message also contains the email
  await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible();
  const inviteToken = await tokenPromise;

  // Invitee opens the accept link in a fresh browser (no session, no SSO).
  const inviteeCtx = await browser.newContext();
  const invitee = await inviteeCtx.newPage();
  await invitee.goto(`${WORKSPACE}/accept-invite?token=${encodeURIComponent(inviteToken)}`);
  await expect(invitee.getByRole('heading', { name: 'Join your team' })).toBeVisible();
  await expect(invitee.getByText(inviteeEmail, { exact: true })).toBeVisible(); // token peek shows who joins
  await expect(invitee.getByRole('button', { name: 'Accept invitation' })).toBeEnabled();
  await invitee.getByLabel('Password').fill(inviteePassword);
  await invitee.getByRole('button', { name: 'Accept invitation' }).click();

  // Auto-login: acceptance minted the session on the org host. Exact-match the
  // workspace ROOT — an unanchored pattern would match /accept-invite itself
  // and resolve before the accept POST finishes.
  await invitee.waitForURL(`${WORKSPACE}/`, { timeout: 60_000 });
  const org = await invitee.request.get(`${WORKSPACE}/api/org`);
  expect(org.status()).toBe(200);
  expect(((await org.json()) as { myOrgRole: string }).myOrgRole).toBe('user');
  await inviteeCtx.close();

  // Owner's panel reflects the join: member listed, no pending invite left.
  await page.reload();
  await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).not.toBeVisible();
});

test('a revoked invitation link answers the uniform expired screen', async ({ browser }) => {
  const page = await ownerPage(browser);

  // Invite via API (same endpoint the form posts to), then revoke through the UI.
  const res = await page.request.post(`${WORKSPACE}/api/org/invitations`, {
    data: { email: `e2e-revoked-${ts}@example.test`, role: 'user' },
  });
  expect(res.status()).toBe(200);
  const { token } = (await res.json()) as { token: string };

  await page.goto(`${WORKSPACE}/admin/members`);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Revoke' }).first().click(); // two-step confirm
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).not.toBeVisible();

  const ctx = await browser.newContext();
  const dead = await ctx.newPage();
  await dead.goto(`${WORKSPACE}/accept-invite?token=${encodeURIComponent(token)}`);
  await dead.getByLabel('Password').fill(inviteePassword);
  await dead.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(dead.getByRole('heading', { name: 'Invitation no longer valid' })).toBeVisible();
  await ctx.close();
});

test('a plain user gets the menu without an Admin section and the panel answers not-authorized', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${WORKSPACE}/auth/login`);
  await loginViaKeycloak(page, inviteeEmail, inviteePassword);

  // The workspace menu renders for everyone, but only with the Projects section.
  await expect(page.getByRole('link', { name: 'All projects' })).toBeVisible();
  await expect(page.getByText('Admin', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Members' })).not.toBeVisible();
  await page.goto(`${WORKSPACE}/admin/members`);
  await expect(page.getByText('Not authorized')).toBeVisible();
  await ctx.close();
});
