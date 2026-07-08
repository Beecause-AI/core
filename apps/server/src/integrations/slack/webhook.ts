import { createHmac, timingSafeEqual } from 'node:crypto';

/** Slack request signing: compare v0=HMAC_SHA256(secret, `v0:{ts}:{rawBody}`). Rejects stale (>5min). */
export function verifySlackSignature(
  rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
