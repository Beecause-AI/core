import { describe, it, expect } from 'vitest';
import { availableToolCatalog, PAGERDUTY_OBSERVABILITY_TOOLS } from '../src/team/tool-catalog.js';
import { computeGaps } from '../src/team/facts.js';
import { ANALYSIS_FLEET } from '../src/team/analysis-fleet/registry.js';

describe('pagerduty team wiring', () => {
  it('includes pagerduty tools in the catalog only when connected', () => {
    const off = availableToolCatalog({ gcp: false, cloudflare: false, aws: false });
    expect(off).not.toContain('integration.pagerduty.list_incidents');
    const on = availableToolCatalog({ gcp: false, cloudflare: false, aws: false, pagerduty: true });
    expect(on).toEqual(expect.arrayContaining(PAGERDUTY_OBSERVABILITY_TOOLS));
  });

  it('raises a Connect PagerDuty gap when detected but not connected', () => {
    const gaps = computeGaps(
      [{ integration: 'pagerduty', product: 'pagerduty', evidence: ['@pagerduty/pdjs'] } as any],
      { gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false },
    );
    expect(gaps[0]?.title).toBe('Connect PagerDuty — pagerduty is in use');
    expect(gaps[0]?.integration).toBe('pagerduty');
  });
});

describe('analysis.pagerduty specialist', () => {
  it('is registered, gated on pagerduty, and uses only catalogued read tools', () => {
    const agent = ANALYSIS_FLEET.find((a) => a.key === 'analysis.pagerduty');
    expect(agent).toBeTruthy();
    expect(agent!.requires).toBe('pagerduty');
    const known = new Set(availableToolCatalog({ gcp: true, cloudflare: true, aws: true, azure: true, datadog: true, dynatrace: true, pagerduty: true }));
    for (const t of agent!.tools) expect(known.has(t)).toBe(true);
  });
});
