import { describe, expect, it } from 'vitest';
import { renderDatadogSkill } from '../src/integrations/skill.js';

const allTools = [
  'integration.datadog.list_scope',
  'integration.datadog.describe_datasets',
  'integration.datadog.query_metrics',
  'integration.datadog.list_metrics',
  'integration.datadog.query_logs',
  'integration.datadog.log_error_summary',
  'integration.datadog.list_traces',
  'integration.datadog.get_trace',
  'integration.datadog.error_rate_summary',
  'integration.datadog.latency_summary',
  'integration.datadog.list_monitors',
];

const allSignals = ['metrics', 'logs', 'traces', 'alerts'] as const;

describe('renderDatadogSkill', () => {
  it('returns empty string when no tools provided', () => {
    expect(renderDatadogSkill([], { signals: [], scope: [] })).toBe('');
  });

  it('contains the Datadog headline when tools and signals are granted', () => {
    const block = renderDatadogSkill(allTools, {
      signals: [...allSignals],
      scope: [{ env: 'prod', service: 'checkout', label: null }],
    });
    expect(block).toContain('## Datadog observability tools');
    expect(block).toContain('Datadog');
  });

  it('includes scope env and service in the footer', () => {
    const block = renderDatadogSkill(allTools, {
      signals: [...allSignals],
      scope: [{ env: 'prod', service: 'checkout', label: null }],
    });
    expect(block).toContain('checkout');
    expect(block).toContain('prod');
  });

  it('drops tools whose signal is not granted', () => {
    const tools = ['integration.datadog.list_scope', 'integration.datadog.query_logs'];
    // Only metrics granted — logs not in signals
    const block = renderDatadogSkill(tools, {
      signals: ['metrics'],
      scope: [{ env: 'prod', service: 'api', label: null }],
    });
    // list_scope is signal-less — always kept
    expect(block).toContain('list_scope');
    // query_logs requires logs signal — must be absent
    expect(block).not.toContain('search Datadog logs');
  });

  it('omits a tool whose signal is not in the granted set', () => {
    const block = renderDatadogSkill(['integration.datadog.query_logs'], {
      signals: ['metrics'],
      scope: [{ env: 'prod', service: null, label: null }],
    });
    expect(block).toBe('');
  });

  it('renders service as (service) in scope when non-null', () => {
    const block = renderDatadogSkill(allTools, {
      signals: [...allSignals],
      scope: [{ env: 'staging', service: 'payments', label: 'my label' }],
    });
    expect(block).toContain('staging');
    expect(block).toContain('payments');
  });

  it('shows no configured env/services when scope is empty', () => {
    const block = renderDatadogSkill(['integration.datadog.list_scope'], {
      signals: [],
      scope: [],
    });
    expect(block).toContain('no Datadog env/services configured');
  });

  it('shows describe_datasets nudge when it is enabled', () => {
    const block = renderDatadogSkill(
      ['integration.datadog.list_scope', 'integration.datadog.describe_datasets'],
      { signals: [], scope: [{ env: 'prod', service: null, label: null }] },
    );
    expect(block).toContain('describe_datasets');
  });

  it('list_scope is always present when any tool is enabled and scope exists', () => {
    const tools = ['integration.datadog.list_scope', 'integration.datadog.query_logs'];
    const block = renderDatadogSkill(tools, {
      signals: ['metrics'],
      scope: [{ env: 'prod', service: 'svc', label: null }],
    });
    expect(block).toContain('list_scope');
    expect(block).not.toContain('search Datadog logs');
  });
});
