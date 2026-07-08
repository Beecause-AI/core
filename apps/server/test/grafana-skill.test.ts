import { describe, expect, it } from 'vitest';
import { renderGrafanaSkill } from '../src/integrations/skill.js';

const all = [
  'integration.grafana.list_scope', 'integration.grafana.describe_datasets',
  'integration.grafana.query_metrics', 'integration.grafana.query_logs',
  'integration.grafana.list_traces', 'integration.grafana.get_trace',
];

describe('renderGrafanaSkill', () => {
  it('drops tools whose signal is not granted', () => {
    const block = renderGrafanaSkill(all, { unrestricted: true, signals: ['metrics'], datasources: [{ uid: 'p1', type: 'prometheus', name: 'Prom' }] });
    expect(block).toContain('query metrics with PromQL');
    expect(block).not.toContain('query logs with LogQL');
    expect(block).toContain('unrestricted');
  });
  it('returns empty when no usable tools', () => {
    expect(renderGrafanaSkill(['integration.grafana.query_logs'], { unrestricted: true, signals: ['metrics'], datasources: [] })).toBe('');
  });
  it('lists scoped datasources', () => {
    const block = renderGrafanaSkill(all, { unrestricted: false, signals: ['metrics', 'logs'], datasources: [{ uid: 'l1', type: 'loki', name: 'Loki' }] });
    expect(block).toContain('Loki (loki)');
  });
});
