export type SignalKind = 'metric' | 'log' | 'trace' | 'error';
export type SignalIntegration = 'gcp' | 'cloudflare' | 'aws' | 'azure' | 'datadog' | 'dynatrace' | 'pagerduty';

export interface SignalSpec {
  kind: SignalKind;
  integration: SignalIntegration;
  tool: string;                       // e.g. 'integration.gcp.query_metrics'
  description: string;
  hint?: Record<string, string>;
}

export interface ProductMarkers {
  deps?: string[];
  depPrefixes?: string[];
  filePatterns?: string[];            // regex sources matched against file paths
  contentPatterns?: string[];         // regex sources matched against scanned file contents
}

export interface SignalSkill {
  id: string;
  product: string;
  integration: SignalIntegration;
  title: string;
  markers: ProductMarkers;
  signals: SignalSpec[];
}

export interface SignalFinding {
  skillId: string;
  product: string;
  integration: SignalIntegration;
  evidence: string[];
  signals: SignalSpec[];
}

export interface RepoSnapshot {
  deps: Set<string>;
  filePaths: string[];
  scannedContent: { path: string; content: string }[];
}
