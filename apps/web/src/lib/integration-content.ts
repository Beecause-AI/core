import type { IntegrationId } from './integrations';

export type IntegrationContent = { valueProp: string; bullets: [string, string, string] };

/** Onboarding copy per integration — used by IntegrationHero. The hero composes the
 *  heading as `Connect <name>` from the INTEGRATIONS registry, so only the value prop
 *  and the three capability bullets live here. */
export const INTEGRATION_CONTENT: Record<IntegrationId, IntegrationContent> = {
  github: {
    valueProp: 'Connect your repositories so assistants can read code, pull requests and branch activity during root-cause analysis.',
    bullets: ['Ground answers in the actual code', 'Trace an incident to a recent change', 'Open issues from a finding'],
  },
  gitlab: {
    valueProp: 'Connect your GitLab repositories so assistants can read code, merge requests and branch activity during root-cause analysis.',
    bullets: ['Ground answers in the actual code', 'Trace an incident to a recent change', 'Open issues from a finding'],
  },
  slack: {
    valueProp: 'Bring Beecause into your Slack workspace for assistant chat, incident alerts and slash commands.',
    bullets: ['Run RCA right from a thread', 'Get incident notifications', 'Hand off to a coding agent'],
  },
  teams: {
    valueProp: 'Bring Beecause into Microsoft Teams — @-mention the bot in a channel to run root-cause analysis with your incident response team.',
    bullets: ['Run RCA right from a channel', 'Reply in the thread automatically', 'No per-user setup — connect a channel once'],
  },
  gcp: {
    valueProp: 'Query metrics, logs and traces from your Google Cloud projects during incident response — your second source of truth after the code.',
    bullets: ['Confirm a hypothesis against production', 'Pre-built RCA recipes', 'Scope to specific GCP projects'],
  },
  aws: {
    valueProp: 'Query CloudWatch metrics and logs, X-Ray traces and alarms from your AWS accounts during root-cause analysis.',
    bullets: ['Spot what changed and when', 'Follow a failing request end-to-end', 'Scope to specific accounts & regions'],
  },
  grafana: {
    valueProp: 'Query your Prometheus, Loki and Tempo data through Grafana during incident response.',
    bullets: ['Native PromQL / LogQL / TraceQL', 'Reuse your existing datasources', 'Scope to specific datasources'],
  },
  sentry: {
    valueProp: 'Pull in Sentry issues, events and stack traces while investigating an incident.',
    bullets: ['Jump from a symptom to the stack trace', 'See what is spiking right now', 'Scope to specific Sentry projects'],
  },
  cloudflare: {
    valueProp: 'Query Cloudflare analytics, logs and Workers during root-cause analysis.',
    bullets: ['Edge & origin error rates', 'Worker errors and logs', 'Scope to specific zones & accounts'],
  },
  azure: {
    valueProp: 'Let assistants query Azure Monitor metrics, Log Analytics (KQL), Application Insights traces, and Azure Monitor alerts to confirm a root cause in production.',
    bullets: [
      'Read Azure Monitor metrics and KQL logs across your subscriptions and workspaces',
      'Follow a failing request end-to-end through Application Insights traces',
      'Read-only — service principal or federated workload identity, scoped per project',
    ],
  },
  datadog: {
    valueProp: 'Let assistants query Datadog metrics, logs, APM traces, and monitors to confirm a root cause in production.',
    bullets: [
      'Read Datadog metrics and search logs across your environments and services',
      'Follow a failing request end-to-end through APM spans and traces',
      'Read-only — API + Application keys, scoped per project to env/service',
    ],
  },
  dynatrace: {
    valueProp: 'Let assistants query Dynatrace metrics, logs, and Davis AI problems to confirm a root cause in production.',
    bullets: [
      'Read Dynatrace service metrics and search logs across your management zones and services',
      'Lean on Davis AI problems for an instant root-cause and affected-entity view',
      'Read-only — a single API token, scoped per project to management zone / service',
    ],
  },
  pagerduty: {
    valueProp: "Let assistants survey PagerDuty incidents and the alerts behind them to confirm what's firing in production and when it started.",
    bullets: [
      'Survey recent and firing incidents across your teams and services',
      "Drill into an incident's raw monitoring alerts and full timeline",
      'Read-only — a single REST API key, scoped per project to team / service',
    ],
  },
};
