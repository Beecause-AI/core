import { describe, it, expect } from 'vitest';
// Importing index registers all skills as side effects.
import { skillsFor, listSkills } from '../src/index.js';
import type { DetectInput } from '../src/index.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function detect(id: string, input: DetectInput) {
  const skill = listSkills().find((s) => s.id === id);
  if (!skill) throw new Error(`skill not found: ${id}`);
  if (!skill.detect) throw new Error(`skill has no detect: ${id}`);
  return skill.detect(input);
}

function emptyInput(overrides: Partial<DetectInput> = {}): DetectInput {
  return { repoFullName: 'o/r', files: [], ...overrides };
}

// ─── Registry: all 9 detectors registered ────────────────────────────────────

describe('detector registration', () => {
  it('registers all 10 detectors in phase structure', () => {
    const ids = skillsFor('structure').map((s) => s.id);
    expect(ids).toContain('detect-postgres');
    expect(ids).toContain('detect-redis');
    expect(ids).toContain('detect-mongo');
    expect(ids).toContain('detect-otel');
    expect(ids).toContain('detect-prometheus');
    expect(ids).toContain('detect-datadog');
    expect(ids).toContain('detect-sentry');
    expect(ids).toContain('detect-cloud-ops');
    expect(ids).toContain('detect-external-sdks');
    expect(ids).toContain('detect-pagerduty');
  });

  it('all detectors have kind detector', () => {
    for (const skill of skillsFor('structure')) {
      expect(skill.kind).toBe('detector');
    }
  });
});

// ─── detect-postgres ─────────────────────────────────────────────────────────

describe('detect-postgres', () => {
  it('detects via pg dependency', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: { packageJson: { dependencies: { pg: '^8' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'datastore', name: 'PostgreSQL', repoFullName: 'o/r', metadata: { provider: 'postgres' } });
  });

  it('detects via postgres dependency', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: { packageJson: { dependencies: { postgres: '^3' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'PostgreSQL' });
  });

  it('detects via pg-promise dependency', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: { packageJson: { dependencies: { 'pg-promise': '^11' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('detects typeorm + pg together', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: { packageJson: { dependencies: { typeorm: '^0.3', pg: '^8' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('does NOT detect typeorm alone (no postgres driver)', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: { packageJson: { dependencies: { typeorm: '^0.3' } } },
    }));
    expect(result).toHaveLength(0);
  });

  it('detects via .sql file', () => {
    const result = detect('detect-postgres', emptyInput({
      files: [{ path: 'db/migrations/001_init.sql' }],
    }));
    expect(result).toHaveLength(1);
  });

  it('detects via DATABASE_URL in file content', () => {
    const result = detect('detect-postgres', emptyInput({
      files: [{ path: '.env.example', content: 'DATABASE_URL=postgres://...' }],
    }));
    expect(result).toHaveLength(1);
  });

  it('detects via POSTGRES_HOST in file content', () => {
    const result = detect('detect-postgres', emptyInput({
      files: [{ path: '.env', content: 'POSTGRES_HOST=localhost\nPOSTGRES_USER=app' }],
    }));
    expect(result).toHaveLength(1);
  });

  it('detects via docker-compose postgres service', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: {
        dockerCompose: {
          services: {
            db: { image: 'postgres:15' },
          },
        },
      },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    const result = detect('detect-postgres', emptyInput({
      manifests: { packageJson: { dependencies: { express: '^4', lodash: '^4' } } },
    }));
    expect(result).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(detect('detect-postgres', emptyInput())).toHaveLength(0);
  });
});

// ─── detect-redis ─────────────────────────────────────────────────────────────

describe('detect-redis', () => {
  it('detects via redis dependency', () => {
    const result = detect('detect-redis', emptyInput({
      manifests: { packageJson: { dependencies: { redis: '^4' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'datastore', name: 'Redis', metadata: { provider: 'redis' } });
  });

  it('detects via ioredis dependency', () => {
    const result = detect('detect-redis', emptyInput({
      manifests: { packageJson: { dependencies: { ioredis: '^5' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('detects via docker-compose redis service', () => {
    const result = detect('detect-redis', emptyInput({
      manifests: {
        dockerCompose: {
          services: {
            cache: { image: 'redis:7-alpine' },
          },
        },
      },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-redis', emptyInput({
      manifests: { packageJson: { dependencies: { express: '^4' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-mongo ─────────────────────────────────────────────────────────────

describe('detect-mongo', () => {
  it('detects via mongodb dependency', () => {
    const result = detect('detect-mongo', emptyInput({
      manifests: { packageJson: { dependencies: { mongodb: '^6' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'datastore', name: 'MongoDB', metadata: { provider: 'mongodb' } });
  });

  it('detects via mongoose dependency', () => {
    const result = detect('detect-mongo', emptyInput({
      manifests: { packageJson: { dependencies: { mongoose: '^8' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-mongo', emptyInput({
      manifests: { packageJson: { dependencies: { pg: '^8' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-otel ─────────────────────────────────────────────────────────────

describe('detect-otel', () => {
  it('detects via @opentelemetry/api dependency → trace + metric nodes', () => {
    const result = detect('detect-otel', emptyInput({
      manifests: { packageJson: { dependencies: { '@opentelemetry/api': '^1', '@opentelemetry/sdk-node': '^0.51' } } },
    }));
    expect(result).toHaveLength(2);
    expect(result.find((n) => n.kind === 'trace')).toMatchObject({ name: 'OpenTelemetry traces', metadata: { provider: 'otel' } });
    expect(result.find((n) => n.kind === 'metric')).toMatchObject({ name: 'OpenTelemetry metrics', metadata: { provider: 'otel' } });
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-otel', emptyInput({
      manifests: { packageJson: { dependencies: { prom_client: '^15' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-prometheus ────────────────────────────────────────────────────────

describe('detect-prometheus', () => {
  it('detects via prom-client dependency', () => {
    const result = detect('detect-prometheus', emptyInput({
      manifests: { packageJson: { dependencies: { 'prom-client': '^15' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'metric', name: 'Prometheus metrics', metadata: { provider: 'prometheus' } });
  });

  it('detects via prometheus dependency', () => {
    const result = detect('detect-prometheus', emptyInput({
      manifests: { packageJson: { dependencies: { prometheus: '^1' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-prometheus', emptyInput({
      manifests: { packageJson: { dependencies: { express: '^4' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-datadog ───────────────────────────────────────────────────────────

describe('detect-datadog', () => {
  it('detects via dd-trace dependency', () => {
    const result = detect('detect-datadog', emptyInput({
      manifests: { packageJson: { dependencies: { 'dd-trace': '^5' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'trace', name: 'Datadog APM', metadata: { provider: 'datadog' } });
  });

  it('detects via @datadog/ scoped package', () => {
    const result = detect('detect-datadog', emptyInput({
      manifests: { packageJson: { dependencies: { '@datadog/browser-rum': '^5' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-datadog', emptyInput({
      manifests: { packageJson: { dependencies: { sentry: '^7' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-sentry ────────────────────────────────────────────────────────────

describe('detect-sentry', () => {
  it('detects via @sentry/node dependency', () => {
    const result = detect('detect-sentry', emptyInput({
      manifests: { packageJson: { dependencies: { '@sentry/node': '^8' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'trace', name: 'Sentry', metadata: { provider: 'sentry' } });
  });

  it('detects via @sentry/react dependency', () => {
    const result = detect('detect-sentry', emptyInput({
      manifests: { packageJson: { dependencies: { '@sentry/react': '^8' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-sentry', emptyInput({
      manifests: { packageJson: { dependencies: { '@opentelemetry/api': '^1' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-cloud-ops ─────────────────────────────────────────────────────────

describe('detect-cloud-ops', () => {
  it('detects Cloud Logging via @google-cloud/logging', () => {
    const result = detect('detect-cloud-ops', emptyInput({
      manifests: { packageJson: { dependencies: { '@google-cloud/logging': '^11' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'log', name: 'Cloud Logging', metadata: { provider: 'cloud-ops' } });
  });

  it('detects Cloud Monitoring via @google-cloud/monitoring', () => {
    const result = detect('detect-cloud-ops', emptyInput({
      manifests: { packageJson: { dependencies: { '@google-cloud/monitoring': '^4' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'metric', name: 'Cloud Monitoring', metadata: { provider: 'cloud-ops' } });
  });

  it('detects Cloud Trace via @google-cloud/trace-agent', () => {
    const result = detect('detect-cloud-ops', emptyInput({
      manifests: { packageJson: { dependencies: { '@google-cloud/trace-agent': '^7' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'trace', name: 'Cloud Trace', metadata: { provider: 'cloud-ops' } });
  });

  it('detects all three when all deps present', () => {
    const result = detect('detect-cloud-ops', emptyInput({
      manifests: {
        packageJson: {
          dependencies: {
            '@google-cloud/logging': '^11',
            '@google-cloud/monitoring': '^4',
            '@google-cloud/trace-agent': '^7',
          },
        },
      },
    }));
    expect(result).toHaveLength(3);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-cloud-ops', emptyInput({
      manifests: { packageJson: { dependencies: { '@google-cloud/storage': '^7' } } },
    }))).toHaveLength(0);
  });
});

// ─── detect-external-sdks ─────────────────────────────────────────────────────

describe('detect-external-sdks', () => {
  it('detects Stripe', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { stripe: '^14' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'Stripe', metadata: { provider: 'stripe' } });
  });

  it('detects Slack via @slack/web-api', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { '@slack/web-api': '^7' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'Slack' });
  });

  it('detects SendGrid', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { '@sendgrid/mail': '^8' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'SendGrid' });
  });

  it('detects Twilio', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { twilio: '^5' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'Twilio' });
  });

  it('detects OpenAI', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { openai: '^4' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'OpenAI' });
  });

  it('detects AWS via @aws-sdk/* package', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { '@aws-sdk/client-s3': '^3' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'AWS' });
  });

  it('deduplicates AWS when multiple @aws-sdk/* packages present', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: {
        packageJson: {
          dependencies: {
            '@aws-sdk/client-s3': '^3',
            '@aws-sdk/client-sqs': '^3',
            '@aws-sdk/client-dynamodb': '^3',
          },
        },
      },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'AWS' });
  });

  it('detects Google APIs', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { googleapis: '^140' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'external', name: 'Google APIs' });
  });

  it('detects multiple SDKs at once', () => {
    const result = detect('detect-external-sdks', emptyInput({
      manifests: {
        packageJson: {
          dependencies: {
            stripe: '^14',
            '@slack/web-api': '^7',
          },
        },
      },
    }));
    expect(result).toHaveLength(2);
    const names = result.map((n) => n.name);
    expect(names).toContain('Stripe');
    expect(names).toContain('Slack');
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-external-sdks', emptyInput({
      manifests: { packageJson: { dependencies: { express: '^4', lodash: '^4' } } },
    }))).toHaveLength(0);
  });

  it('returns empty for empty manifest', () => {
    expect(detect('detect-external-sdks', emptyInput())).toHaveLength(0);
  });
});

// ─── detect-pagerduty ─────────────────────────────────────────────────────────

describe('detect-pagerduty', () => {
  it('detects via @pagerduty/pdjs dependency', () => {
    const result = detect('detect-pagerduty', emptyInput({
      manifests: { packageJson: { dependencies: { '@pagerduty/pdjs': '^2' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'error', name: 'PagerDuty', repoFullName: 'o/r', metadata: { provider: 'pagerduty' } });
  });

  it('detects via node-pagerduty dependency', () => {
    const result = detect('detect-pagerduty', emptyInput({
      manifests: { packageJson: { dependencies: { 'node-pagerduty': '^1' } } },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'PagerDuty', metadata: { provider: 'pagerduty' } });
  });

  it('detects via pagerduty dependency', () => {
    const result = detect('detect-pagerduty', emptyInput({
      manifests: { packageJson: { dependencies: { pagerduty: '^1' } } },
    }));
    expect(result).toHaveLength(1);
  });

  it('returns empty for unrelated deps', () => {
    expect(detect('detect-pagerduty', emptyInput({
      manifests: { packageJson: { dependencies: { express: '^4' } } },
    }))).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(detect('detect-pagerduty', emptyInput())).toHaveLength(0);
  });
});
