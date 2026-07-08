// Org-slug blocklist enforced at SIGNUP. This is a superset of the subdomains the
// edge actually routes specially (those MUST be here so a new org can't shadow them)
// plus names reserved for future product/brand/integration subdomains. Adding a name
// here only blocks NEW signups — it never affects an existing org. Runtime host
// resolution uses the narrower "actually-routed" set in auth/org-context.ts, which is
// intentionally NOT expanded with forward-looking keywords (that would 404 any live
// org whose slug matched a not-yet-built subdomain).
export const RESERVED_SLUGS = [
  // Edge-routed today (must stay reserved):
  'www', 'app', 'auth', 'super', 'webhooks', 'connect', 'send', 'marketing', 'api', 'status', 'docs', 'mail', 'admin',
  'master', // keycloak master realm — org slugs become realm names
  'e2e', // e2e.beecause.ai is the suppressed-email domain for prod E2E identities
  // Brand / marketing / legal:
  'blog', 'help', 'support', 'about', 'pricing', 'contact', 'careers', 'legal', 'privacy', 'terms', 'security',
  // Auth / identity:
  'login', 'logout', 'signup', 'register', 'sso', 'oauth', 'account', 'accounts', 'callback',
  // Infra / ops:
  'cdn', 'assets', 'static', 'media', 'dashboard', 'console', 'internal', 'metrics', 'health', 'healthz', 'ws',
  // Integrations / future apps (GitHub is the first; more to come):
  'slack', 'github', 'gitlab', 'integrations', 'hooks', 'events', 'bot', 'agent',
  // Product surfaces:
  'billing', 'settings', 'teams', 'workspaces',
] as const;

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug.toLowerCase());
}
