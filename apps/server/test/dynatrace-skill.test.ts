import { describe, it, expect } from 'vitest';
import { renderDynatraceSkill } from '../src/integrations/skill.js';

describe('renderDynatraceSkill', () => {
  it('renders only granted-signal tools and lists scope', () => {
    const block = renderDynatraceSkill(
      ['integration.dynatrace.list_scope', 'integration.dynatrace.list_problems', 'integration.dynatrace.query_metrics'],
      { signals: ['problems'], scope: [{ managementZone: 'prod', service: 'checkout', label: null }] },
    );
    expect(block).toContain('Dynatrace');
    expect(block).toContain('list Dynatrace Davis problems'); // problems granted
    expect(block).not.toContain('query Dynatrace metrics');   // metrics not granted
    expect(block).toContain('prod');
  });
  it('returns empty string when no tools are granted', () => {
    expect(renderDynatraceSkill(['integration.dynatrace.query_metrics'], { signals: [], scope: [] })).toBe('');
  });
});
