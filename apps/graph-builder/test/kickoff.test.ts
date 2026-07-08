import { describe, it, expect } from 'vitest';
import { buildOrchestratorKickoff } from '../src/team-autogen.js';

const pubsubSignal = { integration: 'gcp', product: 'Pub/Sub', evidence: ['package.json: @google-cloud/pubsub'], signals: [] } as any;
const pubsubGap = { kind: 'integration', title: 'Connect GCP — Pub/Sub is in use', detail: '', severity: 'critical', audience: 'raise', integration: 'gcp' } as any;

describe('buildOrchestratorKickoff', () => {
  it('seeds the kickoff with detected products + gaps and keeps sequential, adaptive delegation', () => {
    const k = buildOrchestratorKickoff({ gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false }, [pubsubSignal], [pubsubGap]);
    expect(k).toContain('Pub/Sub');                       // detected product surfaced as seed
    expect(k).toContain('Connect GCP — Pub/Sub is in use'); // detected gap surfaced
    expect(k).toMatch(/one at a time/i);                  // sequential delegation preserved
    expect(k).toMatch(/build on/i);                       // adaptive (knowledge-building) delegation
    expect(k).toMatch(/broad|whole domain|thorough/i);    // specialists get a BROAD mandate, not narrow micro-management
    expect(k).toContain('team.submit_proposal');
  });

  it('omits the seed lines when nothing is detected', () => {
    const k = buildOrchestratorKickoff({ gcp: true, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false }, [], []);
    expect(k).toContain('Connected observability domains: GCP');
    expect(k).not.toContain('Detected');
  });

  it('lists AWS as a connected observability domain when aws is connected', () => {
    const k = buildOrchestratorKickoff({ gcp: false, cloudflare: false, aws: true, azure: false, datadog: false, dynatrace: false, pagerduty: false }, [], []);
    expect(k).toContain('AWS');
  });

  it('lists Azure as a connected observability domain when azure is connected', () => {
    const k = buildOrchestratorKickoff({ gcp: false, cloudflare: false, aws: false, azure: true, datadog: false, dynatrace: false, pagerduty: false }, [], []);
    expect(k).toContain('Azure');
  });

  it('lists Datadog as a connected observability domain when datadog is connected', () => {
    const k = buildOrchestratorKickoff({ gcp: false, cloudflare: false, aws: false, azure: false, datadog: true, dynatrace: false, pagerduty: false }, [], []);
    expect(k).toContain('Datadog');
  });
});
