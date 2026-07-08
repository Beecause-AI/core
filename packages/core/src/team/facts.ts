import type { SignalFinding } from '../signals/types.js';
import type { TeamGap } from './proposal-schema.js';

export interface Facts {
  components: { name: string; paths: string[]; summary: string; live: boolean }[];
  codeComplexity: 'low' | 'medium' | 'high';
  signalMap: SignalFinding[];
  customMetrics: { name: string; evidence: string[] }[];
  gaps: TeamGap[];
  /** The full set of tools the composer may assign: code-source tools (always),
   *  connected observability tools, and memory.recall. NEVER includes slack. */
  availableTools: string[];
}

export interface ConnectedSignalIntegrations { gcp: boolean; cloudflare: boolean; aws: boolean; azure: boolean; datadog: boolean; dynatrace: boolean; pagerduty: boolean }

/** Deterministic: a detected product whose backing integration is not connected is a
 *  critical, raise-worthy gap. */
export function computeGaps(findings: SignalFinding[], connected: ConnectedSignalIntegrations): TeamGap[] {
  const gaps: TeamGap[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (connected[f.integration]) continue;
    const key = f.integration + ':' + f.product;
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push({
      kind: 'integration',
      title: `Connect ${f.integration === 'gcp' ? 'GCP' : f.integration === 'cloudflare' ? 'Cloudflare' : f.integration === 'aws' ? 'AWS' : f.integration === 'azure' ? 'Azure' : f.integration === 'datadog' ? 'Datadog' : f.integration === 'dynatrace' ? 'Dynatrace' : 'PagerDuty'} — ${f.product} is in use`,
      detail: `Detected ${f.product} (${f.evidence[0] ?? 'code evidence'}) but the ${f.integration} integration is not connected, so its signals can't be inspected during an incident.`,
      severity: 'critical',
      audience: 'raise',
      integration: f.integration,
    });
  }
  return gaps;
}
