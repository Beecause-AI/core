import { timingSafeEqual } from 'node:crypto';
export { mentionsHandle } from '../github/webhook.js';

export type GitlabEventCategory = 'issues' | 'merge_requests' | 'branches';
export type Classified = { category: GitlabEventCategory; action: string | null; commentBody: string | null };

/** Map a GitLab webhook object_kind to a stored category (or null if not captured). */
export function classifyEvent(objectKind: string, body: any): Classified | null {
  const action = typeof body?.object_attributes?.action === 'string' ? body.object_attributes.action : null;
  switch (objectKind) {
    case 'issue':
      return { category: 'issues', action, commentBody: null };
    case 'merge_request':
      return { category: 'merge_requests', action, commentBody: null };
    case 'note': {
      const noteableType = String(body?.object_attributes?.noteable_type ?? '');
      const category: GitlabEventCategory = noteableType === 'MergeRequest' ? 'merge_requests' : 'issues';
      return { category, action: null, commentBody: body?.object_attributes?.note ?? null };
    }
    case 'push':
    case 'tag_push':
      return { category: 'branches', action: null, commentBody: null };
    default:
      return null;
  }
}

/** Constant-time equality of the inbound X-Gitlab-Token against the connection's secret. */
export function verifyToken(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
