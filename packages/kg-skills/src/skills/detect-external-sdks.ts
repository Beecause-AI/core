import { register } from '../registry.js';
import type { DetectInput, SkillCandidate } from '../types.js';

/**
 * Maps a package name (or prefix) to a human-readable external service name.
 * Entries are checked in order; prefix patterns end with '/'.
 */
const SDK_MAP: Array<{ match: (pkg: string) => boolean; service: string; provider: string }> = [
  { match: (p) => p === 'stripe', service: 'Stripe', provider: 'stripe' },
  { match: (p) => p === '@slack/web-api' || p === '@slack/bolt', service: 'Slack', provider: '@slack/web-api' },
  { match: (p) => p === '@sendgrid/mail' || p === '@sendgrid/client', service: 'SendGrid', provider: '@sendgrid/mail' },
  { match: (p) => p === 'twilio', service: 'Twilio', provider: 'twilio' },
  { match: (p) => p === 'openai', service: 'OpenAI', provider: 'openai' },
  { match: (p) => p.startsWith('@aws-sdk/'), service: 'AWS', provider: '@aws-sdk/*' },
  { match: (p) => p === 'googleapis', service: 'Google APIs', provider: 'googleapis' },
];

register({
  id: 'detect-external-sdks',
  title: 'Detect External Service SDKs',
  description: 'Detects well-known third-party service SDKs (Stripe, Slack, SendGrid, Twilio, OpenAI, AWS, Google APIs) via npm deps.',
  kind: 'detector',
  phase: 'structure',
  integration: 'external',

  detect(input: DetectInput): SkillCandidate[] {
    const pj = input.manifests?.packageJson as Record<string, unknown> | undefined;
    const allDeps: Record<string, unknown> = {
      ...(typeof pj?.['dependencies'] === 'object' && pj?.['dependencies'] ? pj['dependencies'] as Record<string, unknown> : {}),
      ...(typeof pj?.['devDependencies'] === 'object' && pj?.['devDependencies'] ? pj['devDependencies'] as Record<string, unknown> : {}),
    };

    const seen = new Set<string>();
    const candidates: SkillCandidate[] = [];

    for (const pkgName of Object.keys(allDeps)) {
      for (const entry of SDK_MAP) {
        if (entry.match(pkgName) && !seen.has(entry.service)) {
          seen.add(entry.service);
          candidates.push({
            kind: 'external',
            name: entry.service,
            repoFullName: input.repoFullName,
            metadata: { provider: entry.provider },
          });
        }
      }
    }

    return candidates;
  },
});
