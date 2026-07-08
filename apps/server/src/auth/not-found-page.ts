/**
 * Standalone styled pages for auth dead-ends on a workspace host.
 *
 * Server-rendered HTML, not React components — like the email templates, this is
 * the one place brand colors live inline, since the app's design tokens ship with
 * apps/web and never reach the API. Without these, a browser that lands on
 * /auth/login for a missing or temporarily-unreachable workspace would see a raw
 * JSON error blob.
 */
function authPage(opts: { title: string; body: string; cta: { href: string; label: string } }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${opts.title} · Beecause</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: #0A0A0B; color: #EDEDEF;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 24px;
  }
  main { max-width: 26rem; text-align: center; }
  .mark {
    width: 48px; height: 48px; margin: 0 auto 24px;
    display: grid; place-items: center;
    border-radius: 12px; border: 1px solid #34343B; background: #1A1A1F; color: #F6B73C;
  }
  h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
  p { color: #8B8B93; font-size: 0.9375rem; line-height: 1.5; margin: 0 0 24px; }
  a.cta {
    display: inline-block; text-decoration: none;
    color: #0A0A0B; background: #F6B73C; font-weight: 600; font-size: 0.875rem;
    padding: 10px 20px; border-radius: 8px;
  }
  a.cta:hover { background: #F7C45C; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7"/></svg>
  </div>
  <h1>${opts.title}</h1>
  <p>${opts.body}</p>
  <a class="cta" href="${opts.cta.href}">${opts.cta.label}</a>
</main>
</body>
</html>`;
}

/** A workspace host whose slug names no active org. */
export function workspaceNotFoundHtml(homeUrl: string): string {
  return authPage({
    title: 'Workspace not found',
    body: 'This workspace doesn’t exist or hasn’t been activated yet. Check the URL, or head back to find yours.',
    cta: { href: homeUrl, label: 'Go to your workspaces →' },
  });
}

/** The sign-in service couldn't be reached (transient OIDC discovery failure). */
export function authUnavailableHtml(retryUrl: string): string {
  return authPage({
    title: 'Sign-in is temporarily unavailable',
    body: 'We couldn’t reach the sign-in service just now. This is usually brief — please try again in a moment.',
    cta: { href: retryUrl, label: 'Try again' },
  });
}
