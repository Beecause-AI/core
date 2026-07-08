import { registerSignalSkill } from '../registry.js';
import type { SignalSkill } from '../types.js';

export const CLOUDFLARE_SKILLS: SignalSkill[] = [
  { id: 'cloudflare-workers', product: 'cloudflare-workers', integration: 'cloudflare', title: 'Cloudflare Workers',
    markers: { depPrefixes: ['@cloudflare/'], filePatterns: ['wrangler\\.(toml|json|jsonc)$'], contentPatterns: ['export\\s+default\\s*\\{[\\s\\S]*?fetch'] },
    signals: [
      { kind: 'metric', integration: 'cloudflare', tool: 'integration.cloudflare.query_graphql', description: 'Workers requests, errors, CPU time, subrequests' },
      { kind: 'log', integration: 'cloudflare', tool: 'integration.cloudflare.query_worker_logs', description: 'Worker invocation logs' },
      { kind: 'error', integration: 'cloudflare', tool: 'integration.cloudflare.worker_errors', description: 'Worker exceptions' },
    ] },
];

for (const s of CLOUDFLARE_SKILLS) registerSignalSkill(s);
