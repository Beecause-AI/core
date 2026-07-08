import { test, expect } from '@playwright/test';

// Terminal-trace 404 page (apps/web/src/components/not-found-404.tsx).
// Neither case needs auth: resolveOrg 404s unknown org hosts BEFORE the
// session check, and unknown paths never reach the API at all.

test('an org host whose slug names no org shows the workspace 404', async ({ page }) => {
  await page.goto('http://nosuchorg-e2e.localhost:3000/');
  await expect(page.getByText(/workspace not found/i)).toBeVisible({ timeout: 30_000 });
  // CTA leads off the dead org host to the apex picker, keeping port/protocol.
  await expect(page.getByRole('link', { name: /go to your workspaces/i })).toHaveAttribute(
    'href',
    'http://localhost:3000/',
  );
});

test('an unknown path shows the page 404', async ({ page }) => {
  await page.goto('http://localhost:3000/definitely/not/a/page');
  await expect(page.getByText(/page not found/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
});
