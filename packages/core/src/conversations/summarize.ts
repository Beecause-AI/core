export interface SummarizeDeps {
  llm: (prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}
export interface SummarizeInput { priorSummary: string; latestExchange: string }
export interface SummarizeResult { summary: string; inputTokens: number; outputTokens: number }

const PROMPT = `You maintain a short ROLLING summary of an incident investigation conversation.
Keep it concise (at most 6 sentences): what is being investigated, the key findings/signals so far, and the current status.
You are given the PRIOR summary and the LATEST exchange. Produce the NEW summary by folding the latest exchange into the prior summary — do NOT re-derive from scratch, and do not invent details. If the prior summary is empty, summarise from the latest exchange alone.
Respond with ONLY the summary text (no preamble, no markdown).`;

export async function summarizeConversation(deps: SummarizeDeps, input: SummarizeInput): Promise<SummarizeResult> {
  const res = await deps.llm(`${PROMPT}\n\n## Prior summary\n${input.priorSummary || '(none)'}\n\n## Latest exchange\n${input.latestExchange}`);
  return { summary: res.text.trim(), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}
