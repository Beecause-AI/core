import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const LOGGING_DEP = '@google-cloud/logging';
const MONITORING_DEP = '@google-cloud/monitoring';
const TRACE_DEP = '@google-cloud/trace-agent';

register({
  id: 'detect-cloud-ops',
  title: 'Detect Google Cloud Operations',
  description: 'Detects Google Cloud Logging, Monitoring, and Trace Agent via npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'cloud-ops',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const depKeys = new Set(Object.keys(allDeps));
    const candidates: SkillCandidate[] = [];

    if (depKeys.has(LOGGING_DEP)) {
      candidates.push({
        kind: 'log',
        name: 'Cloud Logging',
        repoFullName: input.repoFullName,
        metadata: { provider: 'cloud-ops' },
      });
    }

    if (depKeys.has(MONITORING_DEP)) {
      candidates.push({
        kind: 'metric',
        name: 'Cloud Monitoring',
        repoFullName: input.repoFullName,
        metadata: { provider: 'cloud-ops' },
      });
    }

    if (depKeys.has(TRACE_DEP)) {
      candidates.push({
        kind: 'trace',
        name: 'Cloud Trace',
        repoFullName: input.repoFullName,
        metadata: { provider: 'cloud-ops' },
      });
    }

    return candidates;
  },
});
