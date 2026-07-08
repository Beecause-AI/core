import { describe, it, expect } from 'vitest';
import { renderInventory, type ConnectedIntegrations } from './integration-inventory.js';

describe('renderInventory', () => {
  it('lists connected and missing integrations', () => {
    const inv: ConnectedIntegrations = { github: true, slack: false, gcp: ['prod'], cloudflare: [], aws: [], azure: [], datadog: [], dynatrace: [], pagerduty: [] };
    const text = renderInventory(inv);
    expect(text).toContain('github: connected');
    expect(text).toContain('slack: NOT connected');
    expect(text).toContain('gcp: connected (prod)');
    expect(text).toContain('cloudflare: NOT connected');
    expect(text).toContain('aws: NOT connected');
    expect(text).toContain('azure: NOT connected');
    expect(text).toContain('datadog: NOT connected');
    expect(text).toContain('dynatrace: NOT connected');
  });
});
