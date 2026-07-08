import type { Db, QueuedTurn, VectorIndex } from '@intellilabs/core';
import {
  getOrgById,
  getConversation,
  listConversationMessages,
  setConversationSummary,
  summarizeConversation,
  startOperation,
  finishOperation,
  recordModelInvocation,
  upsertSummaryEmbedding,
} from '@intellilabs/core';
import { costUsd } from '@intellilabs/engine';

export const SUMMARY_MODEL = 'gemini-3-flash-preview';

export interface SummarizeTurnDeps {
  db: Db;
  /** Function that calls the LLM and returns text + token usage. */
  llm: (prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  /** When both present, the new summary is embedded and mirrored into the vector index for recent.search. */
  vector?: VectorIndex;
  embed?: (text: string) => Promise<number[]>;
}

/**
 * Best-effort rolling conversation summarizer.
 *
 * Gate: org must have `hindsightEnabled=true`.
 * Skips internal sub-agent conversations (source === 'internal').
 * Skips conversations with no messages.
 * Persists the new rolling summary and records cost/tokens via an operation + model invocation.
 *
 * Extracted from bootstrap.ts for testability — bootstrap's `maybeSummarize` calls this,
 * passing the real Vertex LLM closure.
 */
export async function summarizeTurn(deps: SummarizeTurnDeps, turn: QueuedTurn): Promise<void> {
  const { db, llm } = deps;

  // Gate: org hindsight flag
  const org = await getOrgById(db, turn.orgId);
  if (!org?.hindsightEnabled) return;

  // Load conversation
  const convo = await getConversation(db, turn.laneId);
  // Only summarise real incident conversations (not internal sub-agent lanes).
  if (!convo || convo.source === 'internal') return;

  // Load messages
  const msgs = await listConversationMessages(db, turn.laneId);
  if (msgs.length === 0) return;

  // Build the latest exchange: last user message + last assistant message
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  const latestExchange = [
    lastUser && `user: ${lastUser.content}`,
    lastAssistant && `assistant: ${lastAssistant.content}`,
  ].filter(Boolean).join('\n');
  if (!latestExchange) return;

  const op = await startOperation(db, {
    orgId: turn.orgId,
    projectId: convo.projectId,
    kind: 'conversation-summary',
    parentConversationId: convo.id,
  });

  try {
    const res = await summarizeConversation({ llm }, { priorSummary: convo.summary ?? '', latestExchange });
    await setConversationSummary(db, convo.id, res.summary);
    // Mirror the summary into the vector index so recent.search can find this incident. Best-effort.
    if (deps.vector && deps.embed && res.summary.trim()) {
      try {
        const embedding = await deps.embed(res.summary);
        if (embedding.length) await upsertSummaryEmbedding(deps.vector, { conversationId: convo.id, orgId: turn.orgId, projectId: convo.projectId, embedding });
      } catch { /* best-effort: indexing must never break the turn */ }
    }
    const cost = costUsd(SUMMARY_MODEL, res.inputTokens, res.outputTokens);
    await recordModelInvocation(db, {
      orgId: turn.orgId,
      source: 'conversation-summary',
      model: SUMMARY_MODEL,
      provider: 'platform',
      operationId: op.id,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: cost.toFixed(6),
      status: 'ok',
    });
    await finishOperation(db, op.id, {
      status: 'done',
      costUsd: cost.toFixed(6),
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    });
  } catch (e) {
    await finishOperation(db, op.id, { status: 'failed' });
    throw e;
  }
}
