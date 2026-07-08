import { describe, it, expect } from 'vitest';
import { friendlyCloudflareError } from './cloudflare-signal-report';

describe('friendlyCloudflareError', () => {
  it('summarizes a 400 without dumping the body', () => {
    const raw = 'Cloudflare 400: {"success":false,"error":{"issues":[{"code":"invalid_type"}]}}';
    expect(friendlyCloudflareError(raw)).toBe('Cloudflare rejected the request (400).');
  });

  it('surfaces the actionable grant hint on a 403', () => {
    const raw = 'Cloudflare 403: forbidden — grant Analytics: Read';
    expect(friendlyCloudflareError(raw)).toBe('Access denied — grant Analytics: Read to the token, then re-verify.');
  });

  it('falls back to generic access-denied on a 403 with no hint', () => {
    expect(friendlyCloudflareError('Cloudflare 403: forbidden')).toMatch(/Access denied/);
  });

  it('handles 429 and 5xx', () => {
    expect(friendlyCloudflareError('Cloudflare 429: too many')).toMatch(/Rate limited/);
    expect(friendlyCloudflareError('Cloudflare 503: down')).toBe('Cloudflare service error (503).');
  });

  it('truncates an unrecognized long error', () => {
    const out = friendlyCloudflareError('x'.repeat(200));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(140);
  });
});
