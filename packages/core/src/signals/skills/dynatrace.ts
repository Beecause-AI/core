import { registerSignalSkill } from '../registry.js';
import type { SignalSkill, SignalSpec } from '../types.js';

const metric = (description: string, hint?: Record<string, string>): SignalSpec =>
  ({ kind: 'metric', integration: 'dynatrace', tool: 'integration.dynatrace.query_metrics', description, hint });
const logs: SignalSpec = { kind: 'log', integration: 'dynatrace', tool: 'integration.dynatrace.query_logs', description: 'Dynatrace Logs (search / error summary)' };
const problems: SignalSpec = { kind: 'error', integration: 'dynatrace', tool: 'integration.dynatrace.list_problems', description: 'Dynatrace Davis problems and alerts' };

export const DYNATRACE_SKILLS: SignalSkill[] = [
  {
    id: 'dynatrace-oneagent',
    product: 'dynatrace-oneagent',
    integration: 'dynatrace',
    title: 'Dynatrace OneAgent / APM',
    markers: {
      deps: ['@dynatrace/oneagent-sdk', '@dynatrace/api-client'],
      filePatterns: ['dynatrace\\.ya?ml$', 'oneagent'],
      contentPatterns: ['DT_API_TOKEN', 'DT_TENANT', 'DT_CLUSTER_ID', 'dynatrace\\.com/api'],
    },
    signals: [
      metric('service response time, error rate, throughput; host CPU/memory'),
      logs,
      problems,
    ],
  },
  {
    id: 'dynatrace-rum',
    product: 'dynatrace-rum',
    integration: 'dynatrace',
    title: 'Dynatrace Real User Monitoring',
    markers: {
      deps: ['@dynatrace/dtrum-api'],
      contentPatterns: ['dtrum\\.', 'dynatrace.*rum'],
    },
    signals: [
      metric('page actions, user errors, web vitals'),
      problems,
    ],
  },
];

for (const s of DYNATRACE_SKILLS) registerSignalSkill(s);
