import { z } from 'zod';
import { catalogModel } from '../models/catalog.js';
import { breakDelegationCycles } from './acyclic.js';

const CHEAP_FALLBACK = 'gemini-3-flash-preview';
const EXPENSIVE_FALLBACK = 'gemini-3.1-pro-preview';

const GITHUB_READ_TOOLS = [
  'integration.github.list_repos',
  'integration.github.get_file',
  'integration.github.list_directory',
  'integration.github.search_code',
  'integration.github.get_ref_info',
];
/** Tools every generated assistant must have: code reading + memory recall (code is the primary
 *  source of truth for RCA). Slack is never assigned (a separate system agent owns comms). Enforced
 *  here so a designed team is never missing them or carrying Slack, regardless of the LLM output. */
const REQUIRED_TOOLS = [...GITHUB_READ_TOOLS, 'memory.recall'];
function normalizeTools(tools: string[]): string[] {
  const kept = tools.filter((t) => !t.startsWith('integration.slack.'));
  return [...new Set([...kept, ...REQUIRED_TOOLS])];
}

export const ProposedAssistantSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  persona: z.string().max(200000).default(''),
  model: z.string().min(1),
  // Intentionally mirrors the server's AssistantBody enum (a superset of catalog
  // PROVIDER_IDS — adds 'openai-compatible' for BYOK endpoints), so a proposed
  // provider can be applied to an assistant verbatim.
  provider: z.enum(['platform', 'anthropic', 'openai', 'google', 'openai-compatible']).nullable().default('platform'),
  isLead: z.boolean().default(false),
  enabledTools: z.array(z.string()).default([]),
  delegatesTo: z.array(z.string()).default([]),
  rationale: z.string().default(''),
});
export type ProposedAssistant = z.infer<typeof ProposedAssistantSchema>;

export const TeamGapSchema = z.object({
  kind: z.enum(['integration', 'data']),
  title: z.string().min(1),
  detail: z.string().default(''),
  severity: z.enum(['critical', 'recommended', 'optional']).default('recommended'),
  audience: z.enum(['raise', 'record']).default('raise'),
  integration: z.enum(['slack', 'gcp', 'cloudflare', 'aws', 'azure', 'github', 'datadog', 'dynatrace', 'pagerduty']).nullable().default(null),
});
export type TeamGap = z.infer<typeof TeamGapSchema>;

export const TeamProposalSchema = z.object({
  rationale: z.string().default(''),
  assistants: z.array(ProposedAssistantSchema).min(1).max(12),
  gaps: z.array(TeamGapSchema).default([]),
});
export type TeamProposalDoc = z.infer<typeof TeamProposalSchema>;

/** Defensive clean-up of raw LLM output already parsed by TeamProposalSchema:
 *  clamp unknown model ids to a catalog id, keep at most one lead, and drop
 *  delegatesTo keys that don't reference a sibling. */
export function normalizeProposal(raw: unknown): TeamProposalDoc {
  const doc = TeamProposalSchema.parse(raw);
  const keys = new Set(doc.assistants.map((a) => a.key));
  let leadSeen = false;
  const cleaned = doc.assistants.map((a) => {
    const model = catalogModel(a.model) ? a.model : a.isLead ? EXPENSIVE_FALLBACK : CHEAP_FALLBACK;
    const isLead = a.isLead && !leadSeen;
    if (isLead) leadSeen = true;
    return { ...a, model, isLead, enabledTools: normalizeTools(a.enabledTools), delegatesTo: a.delegatesTo.filter((k) => k !== a.key && keys.has(k)) };
  });
  // Guarantee the persisted delegation graph is a DAG (no self/back-edges → no loops).
  const assistants = breakDelegationCycles(cleaned);
  return { ...doc, assistants };
}
