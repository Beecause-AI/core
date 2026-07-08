import { describe, expect, it } from 'vitest';
import { renderAwsSkill } from '../src/integrations/skill.js';

const allTools = [
  'integration.aws.list_scope',
  'integration.aws.describe_datasets',
  'integration.aws.query_metrics',
  'integration.aws.list_metrics',
  'integration.aws.error_rate_summary',
  'integration.aws.latency_summary',
  'integration.aws.query_logs',
  'integration.aws.list_log_groups',
  'integration.aws.log_error_summary',
  'integration.aws.list_traces',
  'integration.aws.get_trace',
  'integration.aws.list_alarms',
];

const allSignals = ['metrics', 'logs', 'traces', 'alarms'] as const;

describe('renderAwsSkill', () => {
  it('returns empty string when no tools provided', () => {
    expect(renderAwsSkill([], { signals: [], scope: [] })).toBe('');
  });

  it('contains the AWS observability tools headline when all signals granted', () => {
    const block = renderAwsSkill(allTools, {
      signals: [...allSignals],
      scope: [{ account: '123456789012', region: 'eu-west-1', label: 'prod' }],
    });
    expect(block).toContain('## AWS observability tools');
    expect(block).toContain('query CloudWatch metrics');
    expect(block).toContain('query CloudWatch Logs Insights');
  });

  it('lists account/region in the footer scope line', () => {
    const block = renderAwsSkill(allTools, {
      signals: [...allSignals],
      scope: [{ account: '123456789012', region: 'eu-west-1', label: 'prod' }],
    });
    expect(block).toContain('**AWS accounts/regions in scope:**');
    expect(block).toContain('123456789012/eu-west-1 (prod)');
  });

  it('drops logs-only tools when logs signal is not granted', () => {
    const tools = ['integration.aws.list_scope', 'integration.aws.query_logs'];
    // Only metrics granted — logs not in signals
    const block = renderAwsSkill(tools, {
      signals: ['metrics'],
      scope: [{ account: '123456789012', region: 'us-east-1', label: null }],
    });
    // list_scope is signal-less — always kept
    expect(block).toContain('see which AWS accounts/regions and signals you can query');
    // query_logs requires logs signal — must be absent
    expect(block).not.toContain('query CloudWatch Logs Insights');
  });

  it('list_scope is always present when any tool is enabled', () => {
    // Only list_scope + a logs-only tool, but signals only has metrics → logs tool dropped
    // list_scope itself is signal-less and should survive
    const tools = ['integration.aws.list_scope', 'integration.aws.query_logs'];
    const block = renderAwsSkill(tools, {
      signals: ['metrics'],
      scope: [{ account: '999888777666', region: 'ap-southeast-1', label: null }],
    });
    expect(block).toContain('list_scope');
    expect(block).not.toContain('query CloudWatch Logs Insights');
  });

  it('returns empty string when only logs tool provided but logs signal absent', () => {
    const block = renderAwsSkill(['integration.aws.query_logs'], {
      signals: ['metrics'],
      scope: [{ account: '111', region: 'us-west-2', label: null }],
    });
    expect(block).toBe('');
  });

  it('shows no AWS accounts/regions when scope is empty', () => {
    const block = renderAwsSkill(['integration.aws.list_scope'], {
      signals: [],
      scope: [],
    });
    expect(block).toContain('(no AWS accounts/regions configured)');
  });

  it('omits label parenthetical when label is null', () => {
    const block = renderAwsSkill(allTools, {
      signals: [...allSignals],
      scope: [{ account: '123456789012', region: 'us-east-1', label: null }],
    });
    expect(block).toContain('123456789012/us-east-1');
    expect(block).not.toContain('(null)');
  });
});
