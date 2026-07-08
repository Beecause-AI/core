import { registerSignalSkill } from '../registry.js';
import type { SignalSkill, SignalSpec } from '../types.js';

const metric = (description: string, hint?: Record<string, string>): SignalSpec =>
  ({ kind: 'metric', integration: 'datadog', tool: 'integration.datadog.query_metrics', description, hint });
const logs: SignalSpec = { kind: 'log', integration: 'datadog', tool: 'integration.datadog.query_logs', description: 'Datadog Logs (search / error summary)' };
const traces: SignalSpec = { kind: 'trace', integration: 'datadog', tool: 'integration.datadog.list_traces', description: 'Datadog APM traces and spans' };

export const DATADOG_SKILLS: SignalSkill[] = [
  {
    id: 'datadog-apm',
    product: 'datadog-apm',
    integration: 'datadog',
    title: 'Datadog APM',
    markers: {
      deps: ['dd-trace', 'ddtrace', 'datadog-api-client'],
      filePatterns: ['datadog\\.ya?ml$'],
      contentPatterns: ['DD_API_KEY', 'DD_SERVICE', 'DD_ENV', 'DD_AGENT_HOST'],
    },
    signals: [
      metric('request rate, error rate, latency percentiles'),
      logs,
      traces,
      { kind: 'error', integration: 'datadog', tool: 'integration.datadog.list_monitors', description: 'Datadog Monitors and alerts' },
    ],
  },
  {
    id: 'datadog-browser-rum',
    product: 'datadog-browser-rum',
    integration: 'datadog',
    title: 'Datadog Browser RUM',
    markers: {
      deps: ['@datadog/browser-rum', '@datadog/browser-logs'],
      contentPatterns: ['datadogRum\\.init\\(', 'DD_RUM'],
    },
    signals: [
      metric('page views, errors, LCP/FID/CLS, rage clicks'),
      logs,
    ],
  },
  {
    id: 'datadog-infra',
    product: 'datadog-infra',
    integration: 'datadog',
    title: 'Datadog Infrastructure',
    markers: {
      filePatterns: ['datadog-agent'],
      contentPatterns: ['datadog-agent', 'DD_API_KEY'],
    },
    signals: [
      metric('host CPU, memory, disk, network'),
      { kind: 'error', integration: 'datadog', tool: 'integration.datadog.list_monitors', description: 'Infrastructure monitors and alerts' },
    ],
  },
];

for (const s of DATADOG_SKILLS) registerSignalSkill(s);
