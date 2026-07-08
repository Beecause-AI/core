import type { Db } from '../store/firestore.js';
import { getConversationTree, listConversationMessages } from '../repos/conversations.js';
import { listFullModelInvocations } from '../repos/model-invocations.js';
import { listTracesByConversationId, listTraceSteps } from '../repos/traces.js';
import { listAssistants } from '../repos/assistants.js';
import { getSystemAgent } from '../system-agents/registry.js';

export type ParticipantRole = 'human' | 'assistant' | 'sub-agent' | 'system';

export interface Participant {
  key: string;            // conversationId for an agent; 'human' for the person
  name: string;
  role: ParticipantRole;
  color: string;
}

export type ThreadEvent =
  | { kind: 'message'; id: string; at: string; participantKey: string; conversationId: string; text: string }
  | {
      kind: 'tool'; id: string; at: string; participantKey: string; conversationId: string;
      name: string; status: string; latencyMs: number | null;
      input: string | null; output: string | null; truncated: boolean; error: string | null;
    }
  | { kind: 'handover'; id: string; at: string; fromKey: string; toKey: string; toName: string; task: string | null }
  | { kind: 'return'; id: string; at: string; fromKey: string; toKey: string };

export interface ConversationThread {
  conversationId: string;
  source: string;
  status: string;
  title: string;
  participants: Participant[];
  events: ThreadEvent[];
  /** Whole-tree usage. `costUsd` is null when the org hasn't enabled cost display (gated at the route). */
  totals: { inputTokens: number; outputTokens: number; costUsd: string | null };
}

/** Stable, high-contrast palette for assistant/sub-agent avatars. The human gets a fixed color. */
export const THREAD_PALETTE = [
  '#0ea5e9', '#a855f7', '#f59e0b', '#10b981',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
] as const;

export const HUMAN_COLOR = '#6366f1';

/** Deterministic palette pick from a key (FNV-ish hash). Same key → same color, always. */
export function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return THREAD_PALETTE[h % THREAD_PALETTE.length]!;
}

const HUMAN_KEY = 'human';

function humanName(source: string): string {
  if (source === 'slack') return 'Slack user';
  if (source === 'web') return 'Web user';
  if (source === 'api') return 'API';
  return 'User';
}

/** First user-role message text from a model invocation's input array. Used to recover the
 *  delegation task — the prompt sent to a sub-agent — which the resume-time agent.* trace step
 *  does not persist. NEVER reads system-role content, so the system prompt cannot leak. */
function firstUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'user') continue;
    const c = msg.content;
    if (typeof c === 'string') return c.trim() || null;
    if (Array.isArray(c)) {
      const text = c
        .map((p) =>
          typeof p === 'string'
            ? p
            : p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
              ? (p as { text: string }).text
              : '',
        )
        .join(' ')
        .trim();
      return text || null;
    }
    if (c != null) return JSON.stringify(c);
  }
  return null;
}

export async function buildConversationThread(db: Db, rootId: string): Promise<ConversationThread | null> {
  const tree = await getConversationTree(db, rootId);
  if (!tree.root) return null;
  const convs = [tree.root, ...tree.children];
  const createdAtForConv = new Map(convs.map((c) => [c.id, c.createdAt] as const));
  const ids = convs.map((c) => c.id);

  // ----- participants -----
  const assistants = await listAssistants(db, tree.root.projectId);
  const nameById = new Map(assistants.map((a) => [a.id, a.name] as const));
  const participants: Participant[] = [
    { key: HUMAN_KEY, name: humanName(tree.root.source), role: 'human', color: HUMAN_COLOR },
  ];
  const partKeyForConv = new Map<string, string>();
  for (const c of convs) {
    partKeyForConv.set(c.id, c.id);
    const isRoot = c.id === tree.root.id;
    const role: ParticipantRole = isRoot ? (c.assistantId ? 'assistant' : 'system') : 'sub-agent';
    const name = c.assistantId
      ? (nameById.get(c.assistantId) ?? 'assistant')
      : isRoot
        ? 'Assistant'
        : c.systemAgentKey
          ? (getSystemAgent(c.systemAgentKey)?.name ?? 'system agent')
          : 'system agent';
    participants.push({ key: c.id, name, role, color: colorFor(c.id) });
  }
  const nameForKey = (key: string): string => participants.find((p) => p.key === key)?.name ?? 'sub-agent';

  const events: ThreadEvent[] = [];

  // ----- human turns: conversation_messages role=user (in practice only the root has these) -----
  for (const c of convs) {
    for (const m of await listConversationMessages(db, c.id)) {
      if (m.role !== 'user') continue;
      events.push({ kind: 'message', id: m.id, at: m.createdAt.toISOString(), participantKey: HUMAN_KEY, conversationId: c.id, text: m.content });
    }
  }

  // ----- assistant turns: model_invocations OUTPUT only (system prompt is never read) -----
  const invs = await listFullModelInvocations(db, { conversationIds: ids });

  // A sub-agent's first user message IS the delegation task (subagent spawns the child with
  // messages [system persona, user: input]). Recover it per conversation, earliest invocation
  // first, so the handover marker can show the prompt the sub-agent was given.
  const firstUserByConv = new Map<string, string>();
  for (const iv of [...invs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const cid = iv.conversationId;
    if (!cid || firstUserByConv.has(cid)) continue;
    const t = firstUserText(iv.messages);
    if (t) firstUserByConv.set(cid, t);
  }

  // Whole-tree usage: tokens from model invocations; cost from invocations + tool steps.
  const inputTokens = invs.reduce((s, iv) => s + (iv.inputTokens ?? 0), 0);
  const outputTokens = invs.reduce((s, iv) => s + (iv.outputTokens ?? 0), 0);
  let totalCostUsd = invs.reduce((s, iv) => s + Number(iv.costUsd ?? 0), 0);

  for (const iv of invs) {
    if (!iv.output || iv.output.trim() === '') continue; // pure tool-call turn → no bubble
    const cid = iv.conversationId ?? tree.root.id;
    events.push({ kind: 'message', id: iv.id, at: iv.createdAt.toISOString(), participantKey: partKeyForConv.get(cid) ?? tree.root.id, conversationId: cid, text: iv.output });
  }

  // ----- handovers from child conversations (immediate, at spawn time) -----
  // A child records its delegating parent (parentConversationId) when it is spawned, so the handover
  // renders the MOMENT the sub-agent is created — not only on parent resume (when the agent.* trace
  // step is finally written). Children without a parent link (roots, or pre-2026-06 data) get no
  // handover here and fall back to the resume-time agent.* step below.
  const handoverChildIds = new Set<string>();
  for (const c of convs) {
    if (!c.parentConversationId) continue;
    const fromKey = partKeyForConv.get(c.parentConversationId);
    if (!fromKey) continue; // parent not in this tree — leave it to the trace-step fallback
    handoverChildIds.add(c.id);
    events.push({
      kind: 'handover', id: `${c.id}:ho`, at: c.createdAt.toISOString(),
      fromKey, toKey: partKeyForConv.get(c.id) ?? c.id, toName: nameForKey(partKeyForConv.get(c.id) ?? c.id),
      task: firstUserByConv.get(c.id) ?? null,
    });
  }

  // ----- tools + returns (and fallback handovers): trace_steps -----
  for (const c of convs) {
    const fromKey = partKeyForConv.get(c.id) ?? HUMAN_KEY;
    for (const tr of await listTracesByConversationId(db, c.id)) {
      for (const s of await listTraceSteps(db, tr.id)) {
        if (s.type !== 'tool_call') continue;
        totalCostUsd += Number(s.costUsd ?? 0);
        const at = (s.startedAt ?? new Date(0)).toISOString();
        if (s.childConversationId && s.name.startsWith('agent.')) {
          const toKey = partKeyForConv.get(s.childConversationId) ?? s.childConversationId;
          // Fallback handover only when the child carried no parent link (the immediate pass above
          // already emitted it otherwise). Anchor to the CHILD's creation time — the agent.* step is
          // written on RESUME, too late to bracket the child's work; child.createdAt precedes it.
          if (!handoverChildIds.has(s.childConversationId)) {
            const handoverAt = createdAtForConv.get(s.childConversationId)?.toISOString() ?? at;
            // The agent.* step doesn't persist its call args, so the task comes from the child's
            // first user message (the prompt it was given); fall back to the step args.
            const task = firstUserByConv.get(s.childConversationId) ?? s.args ?? s.argsPreview ?? null;
            events.push({ kind: 'handover', id: s.id, at: handoverAt, fromKey, toKey, toName: nameForKey(toKey), task });
          }
          // Return marks control coming back to the parent — written on resume, so its end is the
          // real "child finished" moment. Always emitted (only exists once the child completed).
          events.push({ kind: 'return', id: `${s.id}:ret`, at: (s.endedAt ?? s.startedAt ?? new Date(0)).toISOString(), fromKey: toKey, toKey: fromKey });
        } else {
          events.push({
            kind: 'tool', id: s.id, at, participantKey: fromKey, conversationId: c.id,
            name: s.name, status: s.status, latencyMs: s.latencyMs,
            input: s.args ?? s.argsPreview ?? null, output: s.result ?? s.resultPreview ?? null,
            truncated: s.truncated, error: s.error,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at));

  const firstUser = events.find((e) => e.kind === 'message' && e.participantKey === HUMAN_KEY) as Extract<ThreadEvent, { kind: 'message' }> | undefined;
  const title = (tree.root.summary && tree.root.summary.trim())
    || (firstUser ? (firstUser.text.length > 80 ? `${firstUser.text.slice(0, 79)}…` : firstUser.text) : 'Conversation');

  return {
    conversationId: tree.root.id,
    source: tree.root.source,
    status: tree.root.status,
    title,
    participants,
    events,
    totals: { inputTokens, outputTokens, costUsd: totalCostUsd.toFixed(6) },
  };
}
