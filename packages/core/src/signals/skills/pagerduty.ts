import { registerSignalSkill } from '../registry.js';
import type { SignalSkill } from '../types.js';

export const PAGERDUTY_SKILLS: SignalSkill[] = [
  {
    id: 'pagerduty-incidents',
    product: 'pagerduty',
    integration: 'pagerduty',
    title: 'PagerDuty',
    markers: {
      deps: ['@pagerduty/pdjs', 'node-pagerduty', 'pdpyras', 'pagerduty'],
      contentPatterns: ['events\\.pagerduty\\.com', 'PAGERDUTY_(API|ROUTING|INTEGRATION)_KEY'],
    },
    signals: [
      { kind: 'error', integration: 'pagerduty', tool: 'integration.pagerduty.list_incidents', description: 'PagerDuty incidents and the alerts behind them' },
    ],
  },
];

for (const s of PAGERDUTY_SKILLS) registerSignalSkill(s);
