import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

const PG_DEPS = new Set(['pg', 'postgres', 'pg-promise']);

function hasPgDep(deps: Record<string, unknown>): boolean {
  for (const name of Object.keys(deps)) {
    if (PG_DEPS.has(name)) return true;
    // typeorm + a postgres driver counts
    if (name === 'typeorm') {
      if ('pg' in deps || 'postgres' in deps) return true;
    }
  }
  return false;
}

function hasComposePostgres(compose: unknown): boolean {
  if (!compose || typeof compose !== 'object') return false;
  const services = (compose as Record<string, unknown>)['services'];
  if (!services || typeof services !== 'object') return false;
  for (const svc of Object.values(services as Record<string, unknown>)) {
    if (!svc || typeof svc !== 'object') continue;
    const image = (svc as Record<string, unknown>)['image'];
    if (typeof image === 'string' && /postgres/i.test(image)) return true;
    const name = (svc as Record<string, unknown>)['container_name'];
    if (typeof name === 'string' && /postgres/i.test(name)) return true;
  }
  return false;
}

const PG_ENV_RE = /\b(DATABASE_URL|POSTGRES_(?:HOST|USER|PASSWORD|DB|PORT))\b/;

function hasFileSignals(files: DetectInput['files']): boolean {
  for (const f of files) {
    if (f.path.endsWith('.sql')) return true;
    if (f.content && PG_ENV_RE.test(f.content)) return true;
  }
  return false;
}

register({
  id: 'detect-postgres',
  title: 'Detect PostgreSQL',
  description: 'Detects PostgreSQL usage via npm deps, SQL files, docker-compose, or env references.',
  kind: 'detector',
  phase: 'structure',
  integration: 'postgres',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const detected =
      hasPgDep(allDeps) ||
      hasComposePostgres(input.manifests?.dockerCompose) ||
      hasFileSignals(input.files);

    if (!detected) return [];

    return [{
      kind: 'datastore',
      name: 'PostgreSQL',
      repoFullName: input.repoFullName,
      metadata: { provider: 'postgres' },
    }];
  },
});
