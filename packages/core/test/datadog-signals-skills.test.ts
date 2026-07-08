import { describe, expect, it } from 'vitest';
import { DATADOG_SKILLS } from '../src/signals/skills/datadog.js';
import { detectSignalsFromSnapshot } from '../src/signals/detect.js';
import type { RepoSnapshot } from '../src/signals/types.js';

describe('DATADOG_SKILLS', () => {
  it('declares datadog-integration skills with markers', () => {
    expect(DATADOG_SKILLS.length).toBeGreaterThan(0);
    expect(DATADOG_SKILLS.every((s) => s.integration === 'datadog')).toBe(true);
    expect(DATADOG_SKILLS.some((s) => s.signals.length > 0)).toBe(true);
    for (const s of DATADOG_SKILLS) {
      for (const sig of s.signals) {
        expect(sig.tool).toMatch(/^integration\.datadog\./);
      }
    }
  });

  it('detects >=1 datadog signal skill from dd-trace dep and DD_SERVICE env var', () => {
    const snap: RepoSnapshot = {
      deps: new Set(['dd-trace']),
      filePaths: [],
      scannedContent: [{ path: '.env', content: 'DD_SERVICE=checkout\nDD_ENV=prod' }],
    };
    const findings = detectSignalsFromSnapshot(DATADOG_SKILLS, snap);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.every((f) => f.integration === 'datadog')).toBe(true);
  });
});
