export * from './types.js';
export { register, listSkills, skillsFor } from './registry.js';

// Skill modules self-register on import (side-effect imports).
import './skills/extract-architecture.js';
import './skills/extract-flows.js';
import './skills/link-dependencies.js';
import './skills/detect-postgres.js';
import './skills/detect-redis.js';
import './skills/detect-mongo.js';
import './skills/detect-otel.js';
import './skills/detect-prometheus.js';
import './skills/detect-datadog.js';
import './skills/detect-pagerduty.js';
import './skills/detect-sentry.js';
import './skills/detect-cloud-ops.js';
import './skills/detect-external-sdks.js';
