import { describe, it, expect } from 'vitest';
import { selectFleet } from '../src/team/analysis-fleet/registry.js';
import { availableToolCatalog, DYNATRACE_OBSERVABILITY_TOOLS } from '../src/team/tool-catalog.js';

describe('dynatrace fleet wiring', () => {
  it('spawns analysis.dynatrace only when connected', () => {
    const off = selectFleet({ github: false, gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false });
    expect(off.find((a) => a.key === 'analysis.dynatrace')).toBeUndefined();
    const on = selectFleet({ github: false, gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: true });
    expect(on.find((a) => a.key === 'analysis.dynatrace')).toBeDefined();
  });
  it('includes the dynatrace tools when connected', () => {
    const cat = availableToolCatalog({ gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: true });
    for (const t of DYNATRACE_OBSERVABILITY_TOOLS) expect(cat).toContain(t);
  });
});
