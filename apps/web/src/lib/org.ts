export const APP_DOMAIN = 'beecause.ai';
// Dev runs the app on {slug}.localhost:3000 (see e2e/run.sh); the server
// resolves those hosts via slugFromHost, so the client must agree.
const DEV_DOMAIN = 'localhost';

/** Org slug for the current host, or null on apex/app host (org-agnostic landing). */
export function currentSlug(hostname?: string): string | null {
  const h = hostname ?? (typeof window === 'undefined' ? null : window.location.hostname);
  if (h === null) return null;
  const domain = h === DEV_DOMAIN || h.endsWith(`.${DEV_DOMAIN}`) ? DEV_DOMAIN : APP_DOMAIN;
  if (h === domain || !h.endsWith(`.${domain}`)) return null;
  const label = h.slice(0, -(domain.length + 1));
  const reserved = ['www', 'app', 'auth', 'super', 'webhooks', 'connect', 'send', 'marketing'];
  if (label.includes('.') || reserved.includes(label)) return null;
  return label;
}

export function orgHostUrl(slug: string, path = '/'): string {
  return `https://${slug}.${APP_DOMAIN}${path}`;
}
