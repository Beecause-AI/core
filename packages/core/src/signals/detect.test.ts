import { describe, it, expect } from 'vitest';
import { detectSignalsFromSnapshot } from './detect.js';
import type { SignalSkill, RepoSnapshot } from './types.js';

const SKILL: SignalSkill = {
  id: 'x', product: 'cloud-run', integration: 'gcp', title: 'Cloud Run',
  markers: { depPrefixes: ['@google-cloud/'], contentPatterns: ['gcp\\.cloudrunv2\\.Service'], filePatterns: ['Dockerfile$'] },
  signals: [{ kind: 'metric', integration: 'gcp', tool: 'integration.gcp.query_metrics', description: 'req/latency/5xx' }],
};

describe('detectSignalsFromSnapshot', () => {
  it('matches on any marker and records evidence', () => {
    const snap: RepoSnapshot = {
      deps: new Set(['@google-cloud/logging']),
      filePaths: ['infra/Dockerfile', 'src/index.ts'],
      scannedContent: [{ path: 'infra/index.ts', content: 'new gcp.cloudrunv2.Service(...)' }],
    };
    const found = detectSignalsFromSnapshot([SKILL], snap);
    expect(found).toHaveLength(1);
    expect(found[0]!.product).toBe('cloud-run');
    expect(found[0]!.evidence.join(' ')).toMatch(/@google-cloud\/logging/);
    expect(found[0]!.evidence.join(' ')).toMatch(/Dockerfile/);
    expect(found[0]!.signals).toHaveLength(1);
  });
  it('returns nothing when no marker matches', () => {
    const snap: RepoSnapshot = { deps: new Set(['react']), filePaths: ['src/app.tsx'], scannedContent: [] };
    expect(detectSignalsFromSnapshot([SKILL], snap)).toHaveLength(0);
  });
});
