import { describe, it, expect } from 'vitest';
import '../index.js'; // triggers registration
import { listSignalSkills } from '../registry.js';
import { detectSignalsFromSnapshot } from '../detect.js';
import type { RepoSnapshot } from '../types.js';

describe('signal skills registry', () => {
  it('registers all v1 products with unique ids and valid integrations', () => {
    const skills = listSignalSkills();
    expect(skills.length).toBeGreaterThanOrEqual(11);
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
    for (const s of skills) {
      expect(['gcp', 'cloudflare', 'aws', 'azure', 'datadog', 'dynatrace', 'pagerduty']).toContain(s.integration);
      expect(s.signals.length).toBeGreaterThan(0);
      for (const sig of s.signals) expect(sig.tool.startsWith('integration.')).toBe(true);
    }
  });
  it('detects cloudflare workers from wrangler.toml and pub/sub from a dependency', () => {
    const snap: RepoSnapshot = { deps: new Set(['@google-cloud/pubsub']), filePaths: ['apps/edge/wrangler.toml'], scannedContent: [] };
    const products = detectSignalsFromSnapshot(listSignalSkills(), snap).map((f) => f.product);
    expect(products).toContain('cloudflare-workers');
    expect(products).toContain('pubsub');
  });
});
