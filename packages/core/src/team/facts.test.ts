import { describe, it, expect } from 'vitest';
import { computeGaps } from './facts.js';
import type { SignalFinding } from '../signals/types.js';

const cloudRun: SignalFinding = { skillId: 'gcp-cloud-run', product: 'cloud-run', integration: 'gcp', evidence: ['file: Dockerfile'], signals: [] };
const workers: SignalFinding = { skillId: 'cloudflare-workers', product: 'cloudflare-workers', integration: 'cloudflare', evidence: ['file: wrangler.toml'], signals: [] };
const lambda: SignalFinding = { skillId: 'aws-lambda', product: 'lambda', integration: 'aws', evidence: ['file: serverless.yml'], signals: [] };

describe('computeGaps', () => {
  it('flags a detected product whose integration is NOT connected as critical+raise', () => {
    const gaps = computeGaps([cloudRun], { gcp: false, cloudflare: true, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.severity).toBe('critical');
    expect(gaps[0]!.audience).toBe('raise');
    expect(gaps[0]!.integration).toBe('gcp');
    expect(gaps[0]!.title).toMatch(/cloud-run/i);
  });
  it('produces no gap when the integration IS connected', () => {
    expect(computeGaps([workers], { gcp: false, cloudflare: true, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false })).toHaveLength(0);
  });
  it('dedupes by integration:product', () => {
    expect(computeGaps([cloudRun, cloudRun], { gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false })).toHaveLength(1);
  });
  it('flags a detected AWS product whose integration is NOT connected with an AWS title', () => {
    const gaps = computeGaps([lambda], { gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.integration).toBe('aws');
    expect(gaps[0]!.title).toMatch(/AWS/);
    expect(gaps[0]!.title).toMatch(/lambda/i);
  });
});
