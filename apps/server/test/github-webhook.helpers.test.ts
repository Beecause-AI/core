import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { classifyEvent, mentionsHandle, verifySignature } from '../src/integrations/github/webhook.js';

describe('classifyEvent', () => {
  it('routes issues + issue lifecycle to "issues" with the action', () => {
    expect(classifyEvent('issues', { action: 'assigned' })).toMatchObject({ category: 'issues', action: 'assigned' });
  });
  it('routes an issue_comment on a plain issue to "issues"', () => {
    expect(classifyEvent('issue_comment', { action: 'created', comment: { body: 'hi' } })).toMatchObject({ category: 'issues', commentBody: 'hi' });
  });
  it('routes an issue_comment on a PR to "pull_requests"', () => {
    expect(classifyEvent('issue_comment', { action: 'created', issue: { pull_request: {} }, comment: { body: 'x' } }))
      .toMatchObject({ category: 'pull_requests' });
  });
  it('routes pull_request* to "pull_requests"', () => {
    expect(classifyEvent('pull_request', { action: 'assigned' })).toMatchObject({ category: 'pull_requests', action: 'assigned' });
    expect(classifyEvent('pull_request_review_comment', { comment: { body: 'c' } })).toMatchObject({ category: 'pull_requests', commentBody: 'c' });
  });
  it('routes push/create/delete to "branches"', () => {
    expect(classifyEvent('push', {})).toMatchObject({ category: 'branches' });
    expect(classifyEvent('delete', { ref_type: 'branch' })).toMatchObject({ category: 'branches' });
  });
  it('returns null for uncaptured events', () => {
    expect(classifyEvent('star', {})).toBeNull();
    expect(classifyEvent('installation', { action: 'deleted' })).toBeNull();
  });
});

describe('mentionsHandle', () => {
  it('detects the bot handle as a whole token, case-insensitive', () => {
    expect(mentionsHandle('hey @intellilabs-agent please look', 'intellilabs-agent')).toBe(true);
    expect(mentionsHandle('@IntelliLabs-Agent', 'intellilabs-agent')).toBe(true);
  });
  it('does not match a substring or a different handle', () => {
    expect(mentionsHandle('email me@intellilabs-agentx.com', 'intellilabs-agent')).toBe(false);
    expect(mentionsHandle('no mention here', 'intellilabs-agent')).toBe(false);
    expect(mentionsHandle(null, 'intellilabs-agent')).toBe(false);
  });
});

describe('verifySignature', () => {
  const secret = 'whsec_test';
  const raw = JSON.stringify({ hello: 'world' });
  const good = 'sha256=' + createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  it('accepts a correct signature', () => { expect(verifySignature(raw, good, secret)).toBe(true); });
  it('rejects a wrong signature / missing header / wrong secret', () => {
    expect(verifySignature(raw, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifySignature(raw, undefined, secret)).toBe(false);
    expect(verifySignature(raw, good, 'other')).toBe(false);
  });
});
