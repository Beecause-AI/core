import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, isReservedSlug } from '../src/routes/reserved-slugs.js';

describe('reserved slugs', () => {
  it('rejects infrastructure hostnames as org slugs', () => {
    for (const slug of ['app', 'www', 'auth', 'super', 'webhooks', 'send', 'api']) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });
  it('reserves the integration callback/webhook hosts', () => {
    expect(isReservedSlug('connect')).toBe(true);
    expect(isReservedSlug('webhooks')).toBe(true);
  });
  it('reserves forward-looking keywords (brand, auth, integrations)', () => {
    for (const slug of ['github', 'slack', 'integrations', 'login', 'signup', 'support', 'billing', 'dashboard']) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });
  it('allows normal slugs (incl. the live "test" org — must NOT be reserved)', () => {
    expect(isReservedSlug('acme')).toBe(false);
    expect(isReservedSlug('apple')).toBe(false); // prefix of 'app' must NOT match
    expect(isReservedSlug('test')).toBe(false); // test.beecause.ai is a live org
  });
  it('is case-insensitive', () => {
    expect(isReservedSlug('APP')).toBe(true);
  });
  it('covers every subdomain the edge routes specially', () => {
    expect(RESERVED_SLUGS).toEqual(
      expect.arrayContaining(['www', 'app', 'auth', 'super', 'webhooks', 'send', 'marketing', 'api', 'status', 'docs', 'mail', 'admin']),
    );
  });
});
