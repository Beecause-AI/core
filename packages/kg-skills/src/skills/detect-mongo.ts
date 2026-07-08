import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const MONGO_DEPS = new Set(['mongodb', 'mongoose']);

register({
  id: 'detect-mongo',
  title: 'Detect MongoDB',
  description: 'Detects MongoDB usage via npm deps (mongodb, mongoose).',
  kind: 'detector',
  phase: 'structure',
  integration: 'mongodb',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected = Object.keys(allDeps).some((k) => MONGO_DEPS.has(k));

    if (!detected) return [];

    return [{
      kind: 'datastore',
      name: 'MongoDB',
      repoFullName: input.repoFullName,
      metadata: { provider: 'mongodb' },
    }];
  },
});
