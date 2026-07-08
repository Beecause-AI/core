import { describe, it, expect } from 'vitest';
import { RCA_OPERATING_PREAMBLE } from './rca-preamble.js';

describe('RCA_OPERATING_PREAMBLE', () => {
  it('is a non-empty markdown string', () => {
    expect(typeof RCA_OPERATING_PREAMBLE).toBe('string');
    expect(RCA_OPERATING_PREAMBLE.trim().length).toBeGreaterThan(0);
  });

  it('contains the key headings: method, source of truth, evidence', () => {
    expect(RCA_OPERATING_PREAMBLE).toContain('## Method');
    expect(RCA_OPERATING_PREAMBLE).toContain('## Source of truth');
    expect(RCA_OPERATING_PREAMBLE).toContain('## Evidence rule');
  });

  it('states the source-of-truth priority (code → metrics/logs/traces → memory)', () => {
    const m = RCA_OPERATING_PREAMBLE.toLowerCase();
    expect(m).toContain('code first');
    expect(m.indexOf('code first')).toBeLessThan(m.indexOf('memory'));
  });

  it('mentions the RCA method steps and the file:line evidence rule', () => {
    const m = RCA_OPERATING_PREAMBLE.toLowerCase();
    expect(m).toContain('reproduce');
    expect(m).toContain('localize');
    expect(m).toContain('root cause');
    expect(RCA_OPERATING_PREAMBLE).toContain('file:line');
  });
});
