import { describe, expect, it } from 'vitest';
import { validateAwsScope, latencyStatistics, logErrorQuery } from '../src/aws/recipes.js';

describe('validateAwsScope', () => {
  const allowed = { pairs: new Set(['111122223333:us-east-1', '111122223333:eu-west-1']) };
  it('accepts an in-scope pair', () => {
    expect(validateAwsScope('111122223333', 'us-east-1', allowed)).toEqual({ ok: true });
  });
  it('rejects an out-of-scope pair', () => {
    const v = validateAwsScope('111122223333', 'ap-south-1', allowed);
    expect(v.ok).toBe(false);
  });
});

describe('recipe helpers', () => {
  it('latencyStatistics returns p50/p95/p99', () => {
    expect(latencyStatistics()).toEqual(['p50', 'p95', 'p99']);
  });
  it('logErrorQuery filters error-like messages', () => {
    expect(logErrorQuery()).toMatch(/filter @message like/i);
  });
});
