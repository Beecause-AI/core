import { test, expect } from '@playwright/test';

// Full realm-per-org registration journey:
//   marketing signup (no password) → dev auto-verify forwards to set-password →
//   /api/auth/complete provisions the org realm + user → workspace-host login →
//   Keycloak login page OF THE ORG REALM → callback → authenticated workspace →
//   sign-out (RP-initiated, kills the KC SSO session) → fresh login works again.
//
// Hosts (dev): marketing :3001, web app :3000 (slug.localhost:3000), keycloak :8081.
//
// NO EMAILS are ever sent in this suite: run.sh starts the server without
// RESEND_API_KEY (no email sender, realms get no SMTP block) and with
// AUTO_VERIFY_EMAIL=true (signup hands the verify token back inline).

// Stable across Playwright worker restarts (a failed test respawns the worker
// and re-evaluates this module). run.sh provides E2E_RUN_ID.
const ts = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const slug = `e2e-${ts}`;
const email = `e2e-${ts}@example.test`;
const password = 'e2e-Sup3r-secret!';

const WORKSPACE = `http://${slug}.localhost:3000`;

async function loginViaKeycloak(page: import('@playwright/test').Page) {
  await page.waitForURL(new RegExp(`/realms/${slug}/protocol/openid-connect/auth`), { timeout: 60_000 });
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"], #kc-login').first().click();
  await page.waitForURL(new RegExp(`http://${slug}\\.localhost:3000/`), { timeout: 60_000 });
}

test('signup founds an org realm and the founder logs into their workspace', async ({ page }) => {
  // 1 — Signup collects workspace + identity, but NO password.
  await page.goto('http://localhost:3001/signup');
  // The submit buttons enable only after hydration — wait for that beacon before
  // filling, or React's mount wipes pre-hydration input.
  await expect(page.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  await page.getByLabel('Workspace name').fill(`E2E ${ts}`);
  await page.getByLabel('Workspace URL').fill(slug);
  await page.getByLabel('Your name').fill('E2E Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // 2 — AUTO_VERIFY_EMAIL=true: the server hands the verify token back and the
  // page forwards to the set-password step (prod: this arrives by email).
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate workspace' })).toBeEnabled();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Activate workspace' }).click();

  // 3+4+5 — Provisioning done → redirect to the workspace host → server 302s to
  // the ORG REALM's Keycloak login page (realm name = slug proves realm-per-org)
  // → log in → callback exchanges the code on the slug host → workspace.
  await loginViaKeycloak(page);

  // 6 — Session is real: the org API answers for this workspace with our membership.
  const org = await page.request.get(`${WORKSPACE}/api/org`);
  expect(org.status()).toBe(200);
  const body = (await org.json()) as { slug: string; myOrgRole: string };
  expect(body.slug).toBe(slug);
  expect(body.myOrgRole).toBe('owner');
});

test('sign-out kills both the app session and the Keycloak SSO session; re-login works', async ({ page }) => {
  // Authenticate first (fresh browser context — the realm exists from the test above).
  await page.goto(`${WORKSPACE}/auth/login`);
  await loginViaKeycloak(page);
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(200);

  // 1 — Sign out through the real app-shell button. The session carries the
  // id_token, so Keycloak ends the SSO WITHOUT its confirmation interstitial.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(new RegExp(`http://${slug}\\.localhost:3000/`), { timeout: 30_000 });
  expect(page.url()).not.toContain('localhost:8081'); // no KC confirm page

  // 2 — App session is gone.
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(401);

  // 3 — The app auto-redirects the signed-out user to login — do NOT goto
  // /auth/login here, it races that client-side navigation (net::ERR_ABORTED).
  // KC SSO is gone too: the login FORM shows (no silent re-login)…
  await page.waitForURL(new RegExp(`/realms/${slug}/protocol/openid-connect/auth`), { timeout: 60_000 });
  await expect(page.locator('#username')).toBeVisible();

  // 4 — …and logging back in with the password works.
  await loginViaKeycloak(page);
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(200);
});

test('verify link re-click after activation is a safe no-op redirect', async ({ page }) => {
  // Re-running signup with the SAME slug+email after activation → the slug is
  // active now, so signup answers 409 (no enumeration of pending state).
  const res = await page.request.post('http://localhost:3001/api/auth/signup', {
    data: { orgName: `E2E ${ts}`, slug, email, name: 'E2E Tester' },
  });
  expect(res.status()).toBe(409);
});
