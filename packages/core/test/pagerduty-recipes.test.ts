import { describe, it, expect } from 'vitest';
import { pagerdutyScopeKey, targetsToFilter, defaultIncidentWindow } from '../src/pagerduty/recipes.js';

describe('pagerduty recipes', () => {
  it('builds a stable scope key from team+service', () => {
    expect(pagerdutyScopeKey('T1', 'S1')).toBe('T1::S1');
    expect(pagerdutyScopeKey(null, 'S1')).toBe('*::S1');
    expect(pagerdutyScopeKey('T1', null)).toBe('T1::*');
  });

  it('collects distinct service + team ids from targets', () => {
    const f = targetsToFilter([
      { teamId: 'T1', serviceId: 'S1' },
      { teamId: 'T1', serviceId: 'S2' },
      { teamId: null, serviceId: 'S1' },
    ]);
    expect(f.serviceIds.sort()).toEqual(['S1', 'S2']);
    expect(f.teamIds).toEqual(['T1']);
  });

  it('defaults to a 7-day all-status window', () => {
    const now = new Date('2026-06-30T00:00:00Z');
    const w = defaultIncidentWindow(now);
    expect(w.since).toBe('2026-06-23T00:00:00.000Z');
    expect(w.statuses).toEqual(['triggered', 'acknowledged', 'resolved']);
    expect(w.sortBy).toBe('created_at:desc');
  });
});
