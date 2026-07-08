import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const REDIS_DEPS = new Set(['redis', 'ioredis']);

function hasRedisDep(deps: Record<string, unknown>): boolean {
  return Object.keys(deps).some((k) => REDIS_DEPS.has(k));
}

function hasComposeRedis(compose: unknown): boolean {
  if (!compose || typeof compose !== 'object') return false;
  const services = (compose as Record<string, unknown>)['services'];
  if (!services || typeof services !== 'object') return false;
  for (const svc of Object.values(services as Record<string, unknown>)) {
    if (!svc || typeof svc !== 'object') continue;
    const image = (svc as Record<string, unknown>)['image'];
    if (typeof image === 'string' && /^redis(:|$)/i.test(image)) return true;
    const name = (svc as Record<string, unknown>)['container_name'];
    if (typeof name === 'string' && /redis/i.test(name)) return true;
  }
  return false;
}

register({
  id: 'detect-redis',
  title: 'Detect Redis',
  description: 'Detects Redis usage via npm deps (redis, ioredis) or docker-compose.',
  kind: 'detector',
  phase: 'structure',
  integration: 'redis',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected = hasRedisDep(allDeps) || hasComposeRedis(input.manifests?.dockerCompose);

    if (!detected) return [];

    return [{
      kind: 'datastore',
      name: 'Redis',
      repoFullName: input.repoFullName,
      metadata: { provider: 'redis' },
    }];
  },
});
