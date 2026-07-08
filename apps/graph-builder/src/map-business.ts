import type { Cluster } from './cluster.js';

export interface MappedFlow {
  name: string;
  digest: string;
  memberTmpIds: string[];
  fileDigests: Record<string, string>;
  embedding: number[];
}

export interface MapBusinessResult {
  flows: MappedFlow[];
  tokens: number;
  partial: boolean;
}

export interface MapBusinessDeps {
  llm: (prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  embed: (texts: string[]) => Promise<number[][]>;
}

export interface MapBusinessInput {
  clusters: Cluster[];
}

interface LlmFlow {
  index: number;
  name: string;
  digest: string;
}

/** Only clusters of at least this many files are named as business flows. A lone
 *  file (no import neighbours) is scaffolding/config, not a flow; naming every
 *  singleton bloats the LLM output (causing truncation → parse failure) and adds
 *  noise. v1 keeps the call to one cluster name+digest per community. */
const MIN_CLUSTER_SIZE = 2;

function buildPrompt(clusters: Cluster[]): string {
  const blocks = clusters
    .map((c, i) => `Cluster ${i} (${c.length} files):\n${c.map((f) => `  - ${f}`).join('\n')}`)
    .join('\n\n');
  return [
    'You map clusters of source-code files to business flows. For each cluster give a short',
    'business-flow name (1-4 words) and a digest (<=2 sentences) describing what the flow does.',
    'Respond with ONLY JSON, no prose, no code fences:',
    '{"flows":[{"index":N,"name":"...","digest":"..."}]}',
    '',
    blocks,
  ].join('\n');
}

function parseFlows(text: string): LlmFlow[] | null {
  const tryParse = (s: string): LlmFlow[] | null => {
    try {
      const obj = JSON.parse(s) as { flows?: LlmFlow[] };
      return Array.isArray(obj.flows) ? obj.flows : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return tryParse(text.slice(start, end + 1));
}

/** Names clusters into business flows with NL digests + a flow-level embedding.
 *  One LLM call (retried once) + one embedding call. On persistent LLM/parse
 *  failure returns {flows:[], partial:true} so the caller persists structural-only. */
export async function mapBusiness(
  deps: MapBusinessDeps,
  input: MapBusinessInput,
): Promise<MapBusinessResult> {
  // Only multi-file communities become flows; singletons are skipped (see MIN_CLUSTER_SIZE).
  const namable = input.clusters.filter((c) => c.length >= MIN_CLUSTER_SIZE);
  if (namable.length === 0) return { flows: [], tokens: 0, partial: false };

  const prompt = buildPrompt(namable);

  let tokens = 0;
  let parsed: LlmFlow[] | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const r = await deps.llm(prompt);
      tokens += r.inputTokens + r.outputTokens;
      parsed = parseFlows(r.text);
    } catch {
      // transient/permanent llm failure on this attempt → retry or fall through to partial
    }
  }
  if (!parsed) return { flows: [], tokens, partial: true };

  const byIndex = new Map(parsed.map((f) => [f.index, f]));
  const named = namable.map((members, i) => {
    const f = byIndex.get(i);
    return {
      name: f?.name?.trim() || `Flow ${i + 1}`,
      digest: f?.digest?.trim() || '',
      memberTmpIds: members,
      fileDigests: {} as Record<string, string>,
    };
  });

  const embeddings = await deps.embed(named.map((f) => `${f.name}\n${f.digest}`));
  const flows: MappedFlow[] = named.map((f, i) => ({ ...f, embedding: embeddings[i] ?? [] }));
  return { flows, tokens, partial: false };
}
