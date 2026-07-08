/**
 * Best-effort extraction of a team proposal that the orchestrator emitted as TEXT — a fenced
 * ```json block, or a bare `{ … }` object — instead of via a clean `team.submit_proposal` tool
 * call. Used as a fallback when an analysis-orchestrator turn reaches a terminal state without a
 * ready proposal (see team-finalize). Returns the parsed object, or null if nothing parseable is
 * found. Validation is the caller's job (normalizeProposal).
 */
export function extractProposalFromText(text: string): unknown | null {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : (text.match(/\{[\s\S]*\}/)?.[0] ?? null);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
