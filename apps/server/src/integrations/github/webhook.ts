import { createHmac, timingSafeEqual } from 'node:crypto';

export type EventCategory = 'issues' | 'pull_requests' | 'branches' | 'repositories';
export type Classified = { category: EventCategory; action: string | null; commentBody: string | null };

/** Map a GitHub event + payload to a stored category (or null if we don't capture it).
 *  `installation*` events are handled separately by the route, so they return null here. */
export function classifyEvent(eventType: string, body: any): Classified | null {
  const action = typeof body?.action === 'string' ? body.action : null;
  switch (eventType) {
    case 'issues':
      return { category: 'issues', action, commentBody: null };
    case 'issue_comment': {
      const isPr = Boolean(body?.issue?.pull_request);
      return { category: isPr ? 'pull_requests' : 'issues', action, commentBody: body?.comment?.body ?? null };
    }
    case 'pull_request':
    case 'pull_request_review':
      return { category: 'pull_requests', action, commentBody: null };
    case 'pull_request_review_comment':
      return { category: 'pull_requests', action, commentBody: body?.comment?.body ?? null };
    case 'push':
    case 'create':
    case 'delete':
      return { category: 'branches', action, commentBody: null };
    case 'repository':
      return { category: 'repositories', action, commentBody: null };
    default:
      return null;
  }
}

/** True if `text` mentions @handle as a whole token (case-insensitive). */
export function mentionsHandle(text: string | null, handle: string): boolean {
  if (!text || !handle) return false;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])@${escaped}($|[^\\w-])`, 'i').test(text);
}

/** Constant-time check of an X-Hub-Signature-256 header against the raw body. */
export function verifySignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
