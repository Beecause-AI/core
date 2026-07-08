import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const PROM_DEPS = new Set(['prom-client', 'prometheus']);

register({
  id: 'detect-prometheus',
  title: 'Detect Prometheus',
  description: 'Detects Prometheus metrics instrumentation via prom-client or prometheus npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'prometheus',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected = Object.keys(allDeps).some((k) => PROM_DEPS.has(k));

    if (!detected) return [];

    return [{
      kind: 'metric',
      name: 'Prometheus metrics',
      repoFullName: input.repoFullName,
      metadata: { provider: 'prometheus' },
    }];
  },
});
