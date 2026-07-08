import { describe, it, expect } from 'vitest';
import {
  CODE_TOOLS,
  GCP_OBSERVABILITY_TOOLS,
  CLOUDFLARE_OBSERVABILITY_TOOLS,
  AWS_OBSERVABILITY_TOOLS,
  AZURE_OBSERVABILITY_TOOLS,
  DATADOG_OBSERVABILITY_TOOLS,
  availableToolCatalog,
} from './tool-catalog.js';
import { listSignalSkills } from '../signals/index.js';

describe('tool-catalog', () => {
  it('CODE_TOOLS are github code-source read tools', () => {
    expect(CODE_TOOLS).toContain('integration.github.get_file');
    expect(CODE_TOOLS).toContain('integration.github.search_code');
    expect(CODE_TOOLS).toContain('integration.github.list_directory');
    for (const t of CODE_TOOLS) expect(t.startsWith('integration.github.')).toBe(true);
  });

  it('availableToolCatalog always includes code tools and memory.recall, never slack', () => {
    const cat = availableToolCatalog({ gcp: false, cloudflare: false, aws: false, azure: false, datadog: false });
    for (const t of CODE_TOOLS) expect(cat).toContain(t);
    expect(cat).toContain('memory.recall');
    expect(cat.some((t) => t.startsWith('integration.slack.'))).toBe(false);
    // No observability tools when nothing connected.
    expect(cat.some((t) => t.startsWith('integration.gcp.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.cloudflare.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.aws.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.azure.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.datadog.'))).toBe(false);
  });

  it('availableToolCatalog adds gcp observability tools only when gcp connected', () => {
    const cat = availableToolCatalog({ gcp: true, cloudflare: false, aws: false });
    for (const t of GCP_OBSERVABILITY_TOOLS) expect(cat).toContain(t);
    expect(cat.some((t) => t.startsWith('integration.cloudflare.'))).toBe(false);
  });

  it('availableToolCatalog adds cloudflare observability tools only when cloudflare connected', () => {
    const cat = availableToolCatalog({ gcp: false, cloudflare: true, aws: false });
    for (const t of CLOUDFLARE_OBSERVABILITY_TOOLS) expect(cat).toContain(t);
    expect(cat.some((t) => t.startsWith('integration.gcp.'))).toBe(false);
  });

  it('availableToolCatalog adds aws observability tools only when aws connected', () => {
    const cat = availableToolCatalog({ gcp: false, cloudflare: false, aws: true });
    for (const t of AWS_OBSERVABILITY_TOOLS) expect(cat).toContain(t);
    expect(cat.some((t) => t.startsWith('integration.gcp.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.cloudflare.'))).toBe(false);
  });

  it('availableToolCatalog adds azure observability tools only when azure connected', () => {
    const cat = availableToolCatalog({ gcp: false, cloudflare: false, aws: false, azure: true });
    for (const t of AZURE_OBSERVABILITY_TOOLS) expect(cat).toContain(t);
    expect(cat.some((t) => t.startsWith('integration.gcp.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.aws.'))).toBe(false);
  });

  it('availableToolCatalog adds datadog observability tools only when datadog connected', () => {
    const cat = availableToolCatalog({ gcp: false, cloudflare: false, aws: false, datadog: true });
    for (const t of DATADOG_OBSERVABILITY_TOOLS) expect(cat).toContain(t);
    expect(cat.some((t) => t.startsWith('integration.gcp.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.aws.'))).toBe(false);
    expect(cat.some((t) => t.startsWith('integration.azure.'))).toBe(false);
  });

  it('observability catalogs cover every tool referenced by the signal skills (kept in sync)', () => {
    const skills = listSignalSkills();
    const gcpSignalTools = new Set<string>();
    const cfSignalTools = new Set<string>();
    const awsSignalTools = new Set<string>();
    const azureSignalTools = new Set<string>();
    const datadogSignalTools = new Set<string>();
    for (const s of skills) {
      for (const sig of s.signals) {
        if (sig.integration === 'gcp') gcpSignalTools.add(sig.tool);
        if (sig.integration === 'cloudflare') cfSignalTools.add(sig.tool);
        if (sig.integration === 'aws') awsSignalTools.add(sig.tool);
        if (sig.integration === 'azure') azureSignalTools.add(sig.tool);
        if (sig.integration === 'datadog') datadogSignalTools.add(sig.tool);
      }
    }
    for (const t of gcpSignalTools) expect(GCP_OBSERVABILITY_TOOLS).toContain(t);
    for (const t of cfSignalTools) expect(CLOUDFLARE_OBSERVABILITY_TOOLS).toContain(t);
    for (const t of awsSignalTools) expect(AWS_OBSERVABILITY_TOOLS).toContain(t);
    for (const t of azureSignalTools) expect(AZURE_OBSERVABILITY_TOOLS).toContain(t);
    for (const t of datadogSignalTools) expect(DATADOG_OBSERVABILITY_TOOLS).toContain(t);
  });
});
