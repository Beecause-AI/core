import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

register({
  id: 'detect-otel',
  title: 'Detect OpenTelemetry',
  description: 'Detects OpenTelemetry usage via @opentelemetry/* npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'otel',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const hasOtel = Object.keys(allDeps).some((k) => k.startsWith('@opentelemetry/'));

    if (!hasOtel) return [];

    return [
      {
        kind: 'trace',
        name: 'OpenTelemetry traces',
        repoFullName: input.repoFullName,
        metadata: { provider: 'otel' },
      },
      {
        kind: 'metric',
        name: 'OpenTelemetry metrics',
        repoFullName: input.repoFullName,
        metadata: { provider: 'otel' },
      },
    ];
  },
});
