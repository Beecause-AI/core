import { describe, it, expect } from 'vitest';
import { ANALYSIS_FLEET, getAnalysisAgent, selectFleet } from './registry.js';
import { availableToolCatalog } from '../tool-catalog.js';

describe('analysis fleet registry', () => {
  it('every agent tool is a known read-only tool (no write/unknown tools)', () => {
    // availableToolCatalog already includes CODE_TOOLS + memory.recall; add the submit builtin.
    const readOnly = new Set([...availableToolCatalog({ gcp: true, cloudflare: true, aws: true, azure: true, datadog: true, dynatrace: true, pagerduty: true }), 'team.submit_proposal']);
    for (const a of ANALYSIS_FLEET) {
      for (const t of a.tools) {
        expect(readOnly.has(t), `${a.key} uses unknown/non-read-only tool ${t}`).toBe(true);
      }
      expect(a.tools).not.toContain('integration.github.create_issue');
    }
  });

  it('selectFleet returns orchestrator always + only connected specialists', () => {
    const none = selectFleet({ github: false, gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false }).map((a) => a.key);
    expect(none).toEqual(['analysis.orchestrator']);
    const gh = selectFleet({ github: true, gcp: false, cloudflare: false, aws: false, azure: false, datadog: false, dynatrace: false, pagerduty: false }).map((a) => a.key);
    expect(gh).toContain('analysis.code');
    expect(gh).not.toContain('analysis.gcp');
    const all = selectFleet({ github: true, gcp: true, cloudflare: true, aws: true, azure: true, datadog: true, dynatrace: true, pagerduty: true }).map((a) => a.key);
    expect(all).toEqual(expect.arrayContaining(['analysis.orchestrator', 'analysis.code', 'analysis.gcp', 'analysis.cloudflare', 'analysis.aws', 'analysis.azure', 'analysis.datadog', 'analysis.dynatrace', 'analysis.pagerduty']));
  });

  it('selectFleet includes the aws specialist only when aws is connected', () => {
    const aws = selectFleet({ github: true, gcp: false, cloudflare: false, aws: true, azure: false, datadog: false, dynatrace: false }).map((a) => a.key);
    expect(aws).toContain('analysis.aws');
    expect(aws).not.toContain('analysis.gcp');
  });

  it('selectFleet includes the azure specialist only when azure is connected', () => {
    const azure = selectFleet({ github: true, gcp: false, cloudflare: false, aws: false, azure: true, datadog: false, dynatrace: false }).map((a) => a.key);
    expect(azure).toContain('analysis.azure');
    expect(azure).not.toContain('analysis.aws');
    expect(azure).not.toContain('analysis.gcp');
  });

  it('selectFleet includes the datadog specialist only when datadog is connected', () => {
    const datadog = selectFleet({ github: true, gcp: false, cloudflare: false, aws: false, azure: false, datadog: true, dynatrace: false }).map((a) => a.key);
    expect(datadog).toContain('analysis.datadog');
    expect(datadog).not.toContain('analysis.aws');
    expect(datadog).not.toContain('analysis.gcp');
  });

  it('getAnalysisAgent resolves by key', () => {
    expect(getAnalysisAgent('analysis.orchestrator')!.role).toBe('orchestrator');
    expect(getAnalysisAgent('nope')).toBeNull();
  });

  it('orchestrator grants specialists a broad mandate (not narrow micro-management) + keeps the evidence rule', () => {
    const orch = getAnalysisAgent('analysis.orchestrator')!;
    expect(orch.persona).toMatch(/broad/i);                 // broad, autonomous domain sweeps
    expect(orch.persona).toMatch(/file:line|primary source of truth/i); // evidence discipline retained
  });

  it('each specialist persona asks for a broad/thorough domain sweep', () => {
    for (const a of ANALYSIS_FLEET.filter((x) => x.role === 'specialist')) {
      expect(a.persona, `${a.key} persona should request a broad/thorough sweep`).toMatch(/broad|thorough/i);
    }
  });
});
