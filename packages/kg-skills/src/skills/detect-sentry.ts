import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

register({
  id: 'detect-sentry',
  title: 'Detect Sentry',
  description: 'Detects Sentry error/trace monitoring via @sentry/* npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'sentry',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected = Object.keys(allDeps).some((k) => k.startsWith('@sentry/'));

    if (!detected) return [];

    return [{
      kind: 'trace',
      name: 'Sentry',
      repoFullName: input.repoFullName,
      metadata: { provider: 'sentry' },
    }];
  },
});
