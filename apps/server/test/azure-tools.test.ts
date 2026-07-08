import { describe, expect, it } from 'vitest';
import { azureToolDefs, filterAzureToolDefs, SIGNAL_OF } from '../src/integrations/azure/tools.js';

describe('azureToolDefs / SIGNAL_OF', () => {
  it('defines integration.azure.* tools, all read-only', () => {
    const defs = azureToolDefs();
    expect(defs.every((d) => d.name.startsWith('integration.azure.') && d.mutates === false)).toBe(true);
    expect(defs.map((d) => d.name)).toContain('integration.azure.query_metrics');
    expect(defs.map((d) => d.name)).toContain('integration.azure.list_scope');
  });

  it('maps each signal-bearing tool to a signal', () => {
    expect(SIGNAL_OF.query_metrics).toBe('metrics');
    expect(SIGNAL_OF.query_logs).toBe('logs');
    expect(SIGNAL_OF.list_traces).toBe('traces');
    expect(SIGNAL_OF.latency_summary).toBe('traces');
    expect(SIGNAL_OF.list_alerts).toBe('alerts');
  });
});

describe('filterAzureToolDefs', () => {
  const defs = azureToolDefs();
  it('returns nothing when the project has no scope', () => {
    expect(filterAzureToolDefs(defs, { hasScope: false, signals: new Set() })).toEqual([]);
  });
  it('always keeps list_scope/describe_datasets, gates the rest by signal', () => {
    const out = filterAzureToolDefs(defs, { hasScope: true, signals: new Set(['metrics']) });
    const names = out.map((d) => d.name.replace('integration.azure.', ''));
    expect(names).toContain('list_scope');
    expect(names).toContain('describe_datasets');
    expect(names).toContain('query_metrics');
    expect(names).not.toContain('query_logs');
    expect(names).not.toContain('list_traces');
  });
});
