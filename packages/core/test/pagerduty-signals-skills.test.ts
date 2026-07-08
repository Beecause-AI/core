// packages/core/test/pagerduty-signals-skills.test.ts
import { describe, it, expect } from 'vitest';
import { PAGERDUTY_SKILLS } from '../src/signals/skills/pagerduty.js';

describe('pagerduty signal skill', () => {
  it('declares an alerts (error-kind) signal bound to list_incidents', () => {
    const skill = PAGERDUTY_SKILLS[0]!;
    expect(skill.integration).toBe('pagerduty');
    const sig = skill.signals.find((s) => s.tool === 'integration.pagerduty.list_incidents');
    expect(sig).toBeTruthy();
    expect(sig!.kind).toBe('error');
  });

  it('matches PagerDuty SDK markers', () => {
    const skill = PAGERDUTY_SKILLS[0]!;
    expect(skill.markers.deps).toContain('@pagerduty/pdjs');
    expect(skill.markers.contentPatterns?.some((p) => new RegExp(p).test('events.pagerduty.com'))).toBe(true);
  });
});
