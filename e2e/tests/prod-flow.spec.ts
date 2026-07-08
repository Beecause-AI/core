import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

// PROD end-to-end: the full realm-per-org journey against the live stack.
// Run via `bash e2e/run-prod.sh` (pulls the secrets below from Pulumi).
//
// NO EMAILS: the test identity lives under @e2e.beecause.ai, which the
// server recognizes and never mails (see signup.ts E2E_EMAIL_RE). Instead of
// reading an inbox, the runner mints the verify token itself with the session
// secret — verification bypass stays restricted to secret holders.
//
// Cleanup: the realm + org/user rows are deleted in global-teardown.ts (runs
// ONCE after the whole run). It is deliberately NOT a test.afterAll: a mid-suite
// failure respawns the Playwright worker, and a worker-scoped afterAll fires at
// that teardown — deleting the shared test org while later tests (sign-out,
// taken-slug) still need it, cascading one failure into three.

const SESSION_SECRET = process.env.PROD_SESSION_SECRET;
const KC_ADMIN_SECRET = process.env.PROD_KC_ADMIN_SECRET;
const DATABASE_URL = process.env.PROD_DATABASE_URL;

test.skip(
  !SESSION_SECRET || !KC_ADMIN_SECRET || !DATABASE_URL,
  'PROD_SESSION_SECRET/PROD_KC_ADMIN_SECRET/PROD_DATABASE_URL not set — run via e2e/run-prod.sh',
);

const MARKETING = 'https://beecause.ai';

// Stable across Playwright worker restarts (a failed test respawns the worker
// and re-evaluates this module — Date.now() here would silently switch slugs
// mid-suite). run-prod.sh provides E2E_RUN_ID.
const ts = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const slug = `e2e-${ts}`;
const orgName = `E2E Prod ${ts}`;
const email = `${slug}@e2e.beecause.ai`; // suppressed pattern — never mailed
const password = `e2e-Passw0rd-${ts}`;
const WORKSPACE = `https://${slug}.beecause.ai`;

async function mintVerifyToken(): Promise<string> {
  // Mirrors apps/server/src/auth/session.ts createVerifyToken.
  return new SignJWT({ kind: 'verify', slug, email, name: 'E2E Prod' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

async function loginViaKeycloak(page: Page) {
  await page.waitForURL(new RegExp(`/realms/${slug}/protocol/openid-connect/auth`), { timeout: 60_000 });
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"], #kc-login').first().click();
  await page.waitForURL(new RegExp(`https://${slug}\\.beecause\\.ai/$`), { timeout: 60_000 });
}

test('signup → set password → first login lands in the workspace', async ({ page }) => {
  // 1 — Marketing signup UI (no password field; submit gated on hydration).
  await page.goto(`${MARKETING}/signup`);
  await expect(page.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  await page.getByLabel('Workspace name').fill(orgName);
  await page.getByLabel('Workspace URL').fill(slug);
  await page.getByLabel('Your name').fill('E2E Prod');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  // 2 — The verify link would be in the (suppressed) email; mint its token instead.
  const token = await mintVerifyToken();
  await page.goto(`${MARKETING}/verify?token=${encodeURIComponent(token)}`);

  // 3 — Set-password step provisions the org realm + account.
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate workspace' })).toBeEnabled();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Activate workspace' }).click();

  // 4 — Activation mints the app session: the founder lands DIRECTLY in the
  // workspace — no manual first login (the breeze requirement).
  await page.waitForURL(new RegExp(`https://${slug}\\.beecause\\.ai/$`), { timeout: 90_000 });
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(200);
  const org = await page.request.get(`${WORKSPACE}/api/org`);
  expect(org.status()).toBe(200);
  const body = (await org.json()) as { slug: string; myOrgRole: string };
  expect(body.slug).toBe(slug);
  expect(body.myOrgRole).toBe('owner');
});

test('sign-out kills the app session AND the Keycloak SSO session; re-login works', async ({ page }) => {
  await page.goto(`${WORKSPACE}/auth/login`);
  await loginViaKeycloak(page);
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(200);

  // Sign out through the real app-shell menu. "Sign out" lives inside the
  // account-menu dropdown, so open it first. The session carries the id_token,
  // so Keycloak must end the SSO WITHOUT its confirmation interstitial — one
  // flow, straight back to the workspace host.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(new RegExp(`https://${slug}\\.beecause\\.ai/`), { timeout: 30_000 });
  expect(page.url()).not.toContain('auth.beecause.ai'); // no KC confirm page
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(401);

  // The app auto-redirects the signed-out user to login — do NOT goto
  // /auth/login here, it races that client-side navigation (net::ERR_ABORTED).
  // SSO is dead: the login FORM shows (no silent re-login)…
  await page.waitForURL(new RegExp(`/realms/${slug}/protocol/openid-connect/auth`), { timeout: 60_000 });
  await expect(page.locator('#username')).toBeVisible();

  // …and logging back in works.
  await loginViaKeycloak(page);
  expect((await page.request.get(`${WORKSPACE}/api/me`)).status()).toBe(200);
});

test('a nonexistent org host shows the styled workspace-not-found page', async ({ page }) => {
  // No auth needed: the app shell loads, finds no session, and redirects to
  // /auth/login, which serves the styled not-found page (not raw JSON) for a
  // host whose slug names no active org.
  await page.goto(`https://nosuchorg-${ts}.beecause.ai/`);
  await expect(page.getByText(/workspace not found/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: /go to your workspaces/i })).toHaveAttribute(
    'href',
    'https://beecause.ai/',
  );
});

test('an unknown path on a workspace host serves the 404 page', async ({ page }) => {
  // Firebase Hosting serves out/404.html for paths matching no exported file.
  await page.goto(`${WORKSPACE}/definitely/not/a/page`);
  await expect(page.getByText(/page not found/i)).toBeVisible({ timeout: 30_000 });
});

test('the activated slug is taken: re-signup → 409', async ({ page }) => {
  const res = await page.request.post(`${MARKETING}/api/auth/signup`, {
    data: { orgName, slug, email: `other-${ts}@e2e.beecause.ai`, name: 'Other' },
  });
  expect(res.status()).toBe(409);
});
