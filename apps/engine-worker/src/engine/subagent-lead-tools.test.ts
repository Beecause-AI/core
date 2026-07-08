import { describe, it, expect } from 'vitest';
import { leadEnabledTools, isIncidentStart, leadSearchTools } from './subagent.js';

describe('leadEnabledTools', () => {
  it('adds conversations.read for the lead orchestrator', () => {
    expect(leadEnabledTools(['integration.github.read'], true)).toContain('conversations.read');
  });
  it('does not duplicate it', () => {
    const out = leadEnabledTools(['conversations.read'], true);
    expect(out.filter((t) => t === 'conversations.read')).toHaveLength(1);
  });
  it('leaves non-lead assistants untouched', () => {
    expect(leadEnabledTools(['integration.github.read'], false)).toEqual(['integration.github.read']);
  });
});

describe('isIncidentStart', () => {
  it('true at a root→lead handoff with no prior children (a new incident)', () => {
    expect(isIncidentStart(0, true, 0)).toBe(true);
  });
  it('false on a reused root that already has children (Slack thread follow-up)', () => {
    expect(isIncidentStart(0, true, 2)).toBe(false);
  });
  it('false for non-lead children or deeper delegations', () => {
    expect(isIncidentStart(0, false, 0)).toBe(false);
    expect(isIncidentStart(1, true, 0)).toBe(false);
  });
});

describe('leadSearchTools', () => {
  it('adds recent.search for a lead when enabled', () => {
    expect(leadSearchTools(['conversations.read'], true, true)).toContain('recent.search');
  });
  it('omits it when disabled', () => {
    expect(leadSearchTools(['conversations.read'], true, false)).not.toContain('recent.search');
  });
  it('omits it for non-leads', () => {
    expect(leadSearchTools(['conversations.read'], false, true)).not.toContain('recent.search');
  });
  it('does not duplicate it', () => {
    expect(leadSearchTools(['recent.search'], true, true).filter((t) => t === 'recent.search')).toHaveLength(1);
  });
});
