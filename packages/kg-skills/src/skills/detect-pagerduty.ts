import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const PD_EXACT = new Set(['@pagerduty/pdjs', 'node-pagerduty', 'pagerduty', 'pdpyras']);

register({
  id: 'detect-pagerduty',
  title: 'Detect PagerDuty',
  description: 'Detects PagerDuty usage via @pagerduty/pdjs, node-pagerduty, or pagerduty npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'pagerduty',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected = Object.keys(allDeps).some((k) => PD_EXACT.has(k));

    if (!detected) return [];

    return [{
      kind: 'error',
      name: 'PagerDuty',
      repoFullName: input.repoFullName,
      metadata: { provider: 'pagerduty' },
    }];
  },
});
