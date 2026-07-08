import { describe, it, expect } from 'vitest';
import { classifyEvent, verifyToken } from './webhook.js';

describe('gitlab classifyEvent', () => {
  it('maps issue → issues', () => expect(classifyEvent('issue', {})?.category).toBe('issues'));
  it('maps merge_request → merge_requests', () => expect(classifyEvent('merge_request', {})?.category).toBe('merge_requests'));
  it('maps push → branches', () => expect(classifyEvent('push', {})?.category).toBe('branches'));
  it('captures note comment body', () => expect(classifyEvent('note', { object_attributes: { note: 'hi @bot' } })?.commentBody).toBe('hi @bot'));
  it('ignores unknown kinds', () => expect(classifyEvent('pipeline', {})).toBeNull());
});

describe('gitlab verifyToken', () => {
  it('true on exact match', () => expect(verifyToken('abc', 'abc')).toBe(true));
  it('false on mismatch or empty', () => {
    expect(verifyToken('abc', 'abd')).toBe(false);
    expect(verifyToken('', 'abc')).toBe(false);
    expect(verifyToken('abc', '')).toBe(false);
  });
});
