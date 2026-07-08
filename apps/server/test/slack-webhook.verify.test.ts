import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySlackSignature } from '../src/integrations/slack/webhook.js';

const secret = 'shh';
const sign = (ts: string, body: string) =>
  'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');

describe('verifySlackSignature', () => {
  const now = 1_700_000_000;
  it('accepts a fresh, correctly signed request', () => {
    const ts = String(now);
    const body = '{"ok":true}';
    expect(verifySlackSignature(body, ts, sign(ts, body), secret, now)).toBe(true);
  });
  it('rejects a bad signature', () => {
    const ts = String(now);
    expect(verifySlackSignature('{}', ts, 'v0=deadbeef', secret, now)).toBe(false);
  });
  it('rejects a stale timestamp (>5 min)', () => {
    const ts = String(now - 301);
    const body = '{}';
    expect(verifySlackSignature(body, ts, sign(ts, body), secret, now)).toBe(false);
  });
});
