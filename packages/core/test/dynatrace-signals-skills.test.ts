import { describe, expect, it } from 'vitest';
import { DYNATRACE_SKILLS } from '../src/signals/skills/dynatrace.js';
import { detectSignalsFromSnapshot } from '../src/signals/detect.js';
import type { RepoSnapshot } from '../src/signals/types.js';

describe('DYNATRACE_SKILLS', () => {
  it('declares dynatrace-integration skills with markers', () => {
    expect(DYNATRACE_SKILLS.length).toBeGreaterThan(0);
    expect(DYNATRACE_SKILLS.every((s) => s.integration === 'dynatrace')).toBe(true);
    expect(DYNATRACE_SKILLS.some((s) => s.signals.length > 0)).toBe(true);
    for (const s of DYNATRACE_SKILLS) {
      for (const sig of s.signals) {
        expect(sig.tool).toMatch(/^integration\.dynatrace\./);
      }
    }
  });

  it('detects >=1 dynatrace signal skill from @dynatrace/oneagent-sdk dep and DT_API_TOKEN env var', () => {
    const snap: RepoSnapshot = {
      deps: new Set(['@dynatrace/oneagent-sdk']),
      filePaths: [],
      scannedContent: [{ path: '.env', content: 'DT_API_TOKEN=abc\nDT_TENANT=xyz' }],
    };
    const findings = detectSignalsFromSnapshot(DYNATRACE_SKILLS, snap);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.every((f) => f.integration === 'dynatrace')).toBe(true);
  });

  it('detects dynatrace-rum from @dynatrace/dtrum-api dep', () => {
    const snap: RepoSnapshot = {
      deps: new Set(['@dynatrace/dtrum-api']),
      filePaths: [],
      scannedContent: [],
    };
    const findings = detectSignalsFromSnapshot(DYNATRACE_SKILLS, snap);
    expect(findings.some((f) => f.product === 'dynatrace-rum')).toBe(true);
  });
});
