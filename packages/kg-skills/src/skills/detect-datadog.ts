import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const DD_EXACT = new Set(['dd-trace', 'datadog']);

register({
  id: 'detect-datadog',
  title: 'Detect Datadog APM',
  description: 'Detects Datadog APM usage via dd-trace, datadog, or @datadog/* npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'datadog',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected = Object.keys(allDeps).some(
      (k) => DD_EXACT.has(k) || k.startsWith('@datadog/'),
    );

    if (!detected) return [];

    return [{
      kind: 'trace',
      name: 'Datadog APM',
      repoFullName: input.repoFullName,
      metadata: { provider: 'datadog' },
    }];
  },
});
