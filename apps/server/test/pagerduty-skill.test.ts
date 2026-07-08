import { describe, expect, it } from 'vitest';
import { renderPagerDutySkill } from '../src/integrations/skill.js';

const allPagerdutyTools = [
  'integration.pagerduty.list_scope',
  'integration.pagerduty.describe_datasets',
  'integration.pagerduty.list_services',
  'integration.pagerduty.list_incidents',
  'integration.pagerduty.get_incident',
  'integration.pagerduty.list_incident_alerts',
  'integration.pagerduty.list_incident_log_entries',
];

describe('renderPagerDutySkill', () => {
  it('returns empty string when no tools provided', () => {
    expect(renderPagerDutySkill([], { signals: [], scope: [] })).toBe('');
  });

  it('contains the PagerDuty headline when tools and signals are granted', () => {
    const block = renderPagerDutySkill(allPagerdutyTools, {
      signals: ['alerts'],
      scope: [{ team: 'Payments', service: 'checkout', label: null }],
    });
    expect(block).toContain('## PagerDuty');
    expect(block).toContain('list_scope');
    expect(block).toContain('list_incidents');
    expect(block).toContain('checkout');
  });

  it('drops tools whose signal is not granted', () => {
    // No signals granted — list_scope/describe_datasets (signal-less) kept, list_incidents (alerts) dropped
    const block = renderPagerDutySkill(
      ['integration.pagerduty.list_scope', 'integration.pagerduty.list_incidents'],
      { signals: [], scope: [{ team: 'Ops', service: null, label: null }] },
    );
    expect(block).toContain('list_scope');
    expect(block).not.toContain('list_incidents');
  });

  it('returns empty string when the only tool requires a signal not granted', () => {
    const block = renderPagerDutySkill(
      ['integration.pagerduty.list_incidents'],
      { signals: [], scope: [{ team: null, service: null, label: null }] },
    );
    expect(block).toBe('');
  });

  it('shows no PagerDuty teams/services configured when scope is empty', () => {
    const block = renderPagerDutySkill(['integration.pagerduty.list_scope'], {
      signals: [],
      scope: [],
    });
    expect(block).toContain('no PagerDuty teams/services configured');
  });

  it('renders team and service in the scope footer', () => {
    const block = renderPagerDutySkill(allPagerdutyTools, {
      signals: ['alerts'],
      scope: [{ team: 'Platform', service: 'payments', label: 'my-label' }],
    });
    expect(block).toContain('Platform');
    expect(block).toContain('payments');
  });
});
