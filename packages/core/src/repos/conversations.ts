import type { Db, Store } from '../store/firestore.js';
import type { VectorIndex } from '../store/vector.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import { chunk, getAllDocs } from '../store/query.js';
import type { Query } from '../ports/store.js';
import type { Conversation, ConversationMessage, Operation } from '../store/types.js';

export type FindOrCreateInput = {
  orgId: string;
  projectId: string;
  // null when the conversation is fronted by a system agent (e.g. the Slack Intake agent),
  // which has no DB assistant row. conversations.assistant_id is nullable.
  assistantId: string | null;
  slackChannelId: string;
  slackThreadTs: string;
};

export async function findOrCreateSlackConversation(db: Db, input: FindOrCreateInput): Promise<Conversation> {
  const existing = await getSlackConversation(db, input.slackChannelId, input.slackThreadTs);
  if (existing) return existing;
  const ref = col(db, 'conversations').doc();
  await ref.set(
    toDoc(
      applyDefaults(
        {
          orgId: input.orgId,
          projectId: input.projectId,
          assistantId: input.assistantId,
          rootConversationId: null,
          source: 'slack',
          status: 'open',
          summary: '',
          slackChannelId: input.slackChannelId,
          slackThreadTs: input.slackThreadTs,
          teamsTenantId: null,
          teamsConversationId: null,
          createdAt: FieldValue.serverTimestamp(),
        },
        ref.id,
      ),
    ),
  );
  // Re-read by (channel, thread) so a concurrent create resolves to a single winner.
  return (await getSlackConversation(db, input.slackChannelId, input.slackThreadTs))!;
}

export async function getSlackConversation(db: Db, channelId: string, threadTs: string): Promise<Conversation | null> {
  const snaps = await col(db, 'conversations')
    .where('slackChannelId', '==', channelId)
    .where('slackThreadTs', '==', threadTs)
    .limit(1)
    .get();
  return snaps.length === 0 ? null : fromDoc<Conversation>(snaps[0]!);
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  const snap = await col(db, 'conversations').doc(id).get();
  return snap.exists ? fromDoc<Conversation>(snap) : null;
}

/** Resolve the Slack thread that fronts a conversation — walking to the ROOT conversation so a
 *  failure (or final answer) in a nested internal sub-agent turn can still be delivered to the
 *  originating Slack thread. Returns null when the tree is not Slack-rooted. `placeholderTs` is
 *  the root's most recent Slack turn's status message (best-effort; edit it to avoid a dangling
 *  "thinking…"/"Delegating…"). */
export async function getSlackRootTarget(
  db: Db,
  conversationId: string,
): Promise<{ orgId: string; channel: string; threadTs: string; placeholderTs?: string } | null> {
  const convo = await getConversation(db, conversationId);
  if (!convo) return null;
  const rootId = convo.rootConversationId ?? convo.id;
  const root = rootId === convo.id ? convo : await getConversation(db, rootId);
  if (!root?.slackChannelId || !root?.slackThreadTs) return null;
  const snaps = await col(db, 'message_queue')
    .where('laneId', '==', rootId)
    .where('source', '==', 'slack')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const latest = snaps.length === 0 ? null : fromDoc<{ payload: unknown }>(snaps[0]!);
  const placeholderTs = (latest?.payload as { slack?: { placeholderTs?: string } } | null)?.slack?.placeholderTs;
  return { orgId: root.orgId, channel: root.slackChannelId, threadTs: root.slackThreadTs, placeholderTs };
}

export type AppendMessageInput = {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  slackUserId?: string | null;
  teamsUserId?: string | null;
};

/** Append with a per-conversation transactional counter so concurrent appends get distinct,
 *  ordered seqs with no gaps. The counter (`msgSeq`) lives on the conversation doc; Firestore
 *  retries the transaction on contention (replaces pg_advisory_xact_lock + max(seq)+1). */
export async function appendConversationMessage(db: Db, input: AppendMessageInput): Promise<ConversationMessage> {
  const mref = col(db, 'conversation_messages').doc();
  await db.runTransaction(async (tx) => {
    const cref = col(db, 'conversations').doc(input.conversationId);
    const cs = await tx.get(cref); // read before any write
    const seq = ((cs.data()?.msgSeq as number) ?? 0) + 1;
    tx.set(cref, { msgSeq: seq }, { merge: true });
    tx.set(
      mref,
      toDoc(
        applyDefaults(
          {
            id: mref.id,
            conversationId: input.conversationId,
            seq,
            role: input.role,
            content: input.content,
            slackUserId: input.slackUserId ?? null,
            teamsUserId: input.teamsUserId ?? null,
            createdAt: FieldValue.serverTimestamp(),
          },
          mref.id,
        ),
      ),
    );
  });
  return fromDoc<ConversationMessage>(await mref.get());
}

export async function listConversationMessages(db: Db, conversationId: string): Promise<ConversationMessage[]> {
  const snaps = await col(db, 'conversation_messages')
    .where('conversationId', '==', conversationId)
    .orderBy('seq', 'asc')
    .get();
  return snaps.map((d) => fromDoc<ConversationMessage>(d));
}

export async function createConversation(db: Db, input: {
  orgId: string;
  projectId: string;
  assistantId: string | null;
  systemAgentKey?: string | null;
  source?: string;
  rootConversationId?: string | null;
  parentConversationId?: string | null;
}): Promise<Conversation> {
  const ref = col(db, 'conversations').doc();
  await ref.set(
    toDoc(
      applyDefaults(
        {
          orgId: input.orgId,
          projectId: input.projectId,
          assistantId: input.assistantId,
          systemAgentKey: input.systemAgentKey ?? null,
          source: input.source ?? 'internal',
          status: 'open',
          summary: '',
          rootConversationId: input.rootConversationId ?? null,
          parentConversationId: input.parentConversationId ?? null,
          slackChannelId: null,
          slackThreadTs: null,
          teamsTenantId: null,
          teamsConversationId: null,
          createdAt: FieldValue.serverTimestamp(),
        },
        ref.id,
      ),
    ),
  );
  return fromDoc<Conversation>(await ref.get());
}

export async function listConversationsForProject(db: Db, projectId: string, limit = 50): Promise<Conversation[]> {
  const snaps = await col(db, 'conversations')
    .where('projectId', '==', projectId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snaps.map((d) => fromDoc<Conversation>(d));
}

export async function listRootConversations(
  db: Db, opts: { before?: Date; limit?: number; excludeInternal?: boolean } = {},
): Promise<Conversation[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  let q: Query = col(db, 'conversations').where('rootConversationId', '==', null);
  if (opts.before) q = q.where('createdAt', '<', opts.before);
  q = q.orderBy('createdAt', 'desc').limit(limit);
  const snaps = await q.get();
  let rows = snaps.map((d) => fromDoc<Conversation>(d));
  // The activity feed hides internal machinery (e.g. the agentic team-gen analysis conversation,
  // which is surfaced as its team-autogen operation instead). Firestore can't combine a `!=`
  // inequality with the createdAt range, so filter `source != 'internal'` in JS.
  if (opts.excludeInternal) rows = rows.filter((r) => r.source !== 'internal');
  return rows;
}

/** Number of sub-agent child conversations under a root — i.e. how many delegations have happened
 *  so far in this conversation tree. Used to cap runaway fleet delegation. */
export async function countChildConversations(db: Db, rootId: string): Promise<number> {
  const snap = await col(db, 'conversations').where('rootConversationId', '==', rootId).get();
  return snap.length;
}

/** Distinct assistantIds participating in a conversation tree (root + sub-agent children).
 *  Drives the list-row avatar cluster without walking every message. Pass `rootAssistantId`
 *  when the caller already holds the root conversation, to skip a redundant root read. */
export async function listTreeAssistantIds(
  db: Db, rootId: string, rootAssistantId?: string | null,
): Promise<string[]> {
  const [rootConvo, childSnaps] = await Promise.all([
    rootAssistantId !== undefined ? null : getConversation(db, rootId),
    col(db, 'conversations').where('rootConversationId', '==', rootId).get(),
  ]);
  const ids = new Set<string>();
  const effectiveRoot = rootAssistantId ?? rootConvo?.assistantId;
  if (effectiveRoot) ids.add(effectiveRoot);
  for (const d of childSnaps) {
    const a = fromDoc<Conversation>(d).assistantId;
    if (a) ids.add(a);
  }
  return [...ids];
}

export interface ConversationSummary {
  id: string;
  source: string;
  status: string;
  title: string;
  preview: string | null;
  assistantIds: string[];   // participating assistants (root + children); web maps to avatars
  agentCount: number;       // assistantIds.length (convenience for the "+N" badge)
  createdAt: string;
  lastActivityAt: string;
}

const trunc = (s: string, n = 80): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Roots-only conversation summaries for a project, newest first. Excludes operations
 *  (`source == 'internal'`) and sub-agent children (`rootConversationId != null`). */
export async function listConversationSummaries(
  db: Db, projectId: string, opts: { limit?: number } = {},
): Promise<ConversationSummary[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const snaps = await col(db, 'conversations')
    .where('rootConversationId', '==', null)
    .where('projectId', '==', projectId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  const roots = snaps
    .map((d) => fromDoc<Conversation>(d))
    .filter((c) => c.source !== 'internal'); // Firestore can't combine `!=` with the range; filter in JS

  return Promise.all(
    roots.map(async (c): Promise<ConversationSummary> => {
      const [messages, assistantIds] = await Promise.all([
        listConversationMessages(db, c.id),
        listTreeAssistantIds(db, c.id, c.assistantId),
      ]);
      const last = messages.length > 0 ? messages[messages.length - 1]! : null;
      const firstUser = messages.find((m) => m.role === 'user');
      const title = (c.summary && c.summary.trim()) || (firstUser ? trunc(firstUser.content) : 'Conversation');
      return {
        id: c.id,
        source: c.source,
        status: c.status,
        title,
        preview: last ? trunc(last.content, 120) : null,
        assistantIds,
        agentCount: assistantIds.length,
        createdAt: c.createdAt.toISOString(),
        lastActivityAt: (last?.createdAt ?? c.createdAt).toISOString(),
      };
    }),
  );
}

/** Cost + call-count (and rate-limited-attempt count) over the incident root and all its
 *  sub-agent children. `rateLimitedCount` surfaces EVERY 429 attempt across the tree, live. */
export async function incidentRollup(db: Db, rootId: string): Promise<{ costUsd: string; callCount: number; rateLimitedCount: number }> {
  // conversations where id == rootId OR rootConversationId == rootId (cross-field OR → two queries).
  const idSet = new Set<string>();
  const rootSnap = await col(db, 'conversations').doc(rootId).get();
  if (rootSnap.exists) idSet.add(rootSnap.id);
  const childSnaps = await col(db, 'conversations').where('rootConversationId', '==', rootId).get();
  for (const d of childSnaps) idSet.add(d.id);

  const idList = [...idSet];
  if (idList.length === 0) return { costUsd: '0', callCount: 0, rateLimitedCount: 0 };

  // sum(costUsd) + count() over model_invocations for those conversations. `in` caps at 30 → chunk.
  let totalCost = 0;
  let totalN = 0;
  let rateLimited = 0;
  for (const batch of chunk(idList, 30)) {
    const agg = await col(db, 'model_invocations')
      .where('conversationId', 'in', batch)
      .aggregate({ sum: 'costUsd', count: true });
    totalCost += agg.sum ?? 0;
    totalN += agg.count ?? 0;
    // Separate filtered count for rate-limited attempts (needs the (conversationId, rateLimited)
    // composite index declared in infra/src/firestore.ts).
    const rl = await col(db, 'model_invocations')
      .where('conversationId', 'in', batch)
      .where('rateLimited', '==', true)
      .aggregate({ count: true });
    rateLimited += rl.count ?? 0;
  }
  return { costUsd: String(totalCost), callCount: totalN, rateLimitedCount: rateLimited };
}

export type ActivityRow = {
  kind: 'conversation' | 'operation';
  id: string; title: string; subKind: string | null;
  orgId: string | null; projectId: string | null;
  createdAt: Date; status: string; costUsd: string; callCount: number;
  /** Number of 429 rate-limited attempts across this incident's tree (0 = none). */
  rateLimitedCount: number;
};

/** Time-ordered roots (conversations) + top-level operations, newest first. */
export async function listActivity(
  db: Db, opts: { type?: 'conversation' | 'operation'; before?: Date; limit?: number } = {},
): Promise<ActivityRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const out: ActivityRow[] = [];

  if (opts.type !== 'operation') {
    const roots = await listRootConversations(db, { before: opts.before, limit, excludeInternal: true });
    for (const r of roots) {
      const roll = await incidentRollup(db, r.id);
      out.push({ kind: 'conversation', id: r.id, title: r.source, subKind: r.source,
        orgId: r.orgId, projectId: r.projectId, createdAt: r.createdAt, status: 'done',
        costUsd: roll.costUsd, callCount: roll.callCount, rateLimitedCount: roll.rateLimitedCount });
    }
  }
  if (opts.type !== 'conversation') {
    let q: Query = col(db, 'operations').where('parentConversationId', '==', null);
    if (opts.before) q = q.where('startedAt', '<', opts.before);
    q = q.orderBy('startedAt', 'desc').limit(limit);
    const ops = (await q.get()).map((d) => fromDoc<Operation & { costUsd: number | string | null }>(d));
    for (const o of ops) {
      out.push({ kind: 'operation', id: o.id, title: o.kind, subKind: o.kind,
        orgId: o.orgId, projectId: o.projectId, createdAt: o.startedAt, status: o.status,
        costUsd: String(o.costUsd ?? 0), callCount: 0, rateLimitedCount: 0 });
    }
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

export async function getConversationTree(
  db: Db, rootId: string,
): Promise<{ root: Conversation | null; children: Conversation[] }> {
  const rootSnap = await col(db, 'conversations').doc(rootId).get();
  // A missing doc must surface as a null root, NOT a "ghost" {id} object. fromDoc defaults absent
  // data to {}, so a ghost root has projectId === undefined, which crashes downstream queries
  // (e.g. listAssistants → where('projectId','==',undefined)). All callers guard on `!root`.
  if (!rootSnap.exists) return { root: null, children: [] };
  const childSnaps = await col(db, 'conversations')
    .where('rootConversationId', '==', rootId)
    .orderBy('createdAt', 'asc')
    .get();
  return {
    root: fromDoc<Conversation>(rootSnap),
    children: childSnaps.map((d) => fromDoc<Conversation>(d)),
  };
}

export async function setConversationSummary(db: Db, conversationId: string, summary: string): Promise<void> {
  await col(db, 'conversations').doc(conversationId).update(toDoc({ summary }));
}

/** Mirror a conversation summary into the shared vector index so `recent.search` (Vertex ANN)
 *  can find it. Namespace via restricts: { orgId, projectId, kind: 'summary' }. Datapoint id is
 *  the conversation id, so re-summarizing the same conversation overwrites its point. */
export async function upsertSummaryEmbedding(
  vector: VectorIndex,
  input: { conversationId: string; orgId: string; projectId: string; embedding: number[] },
): Promise<void> {
  await vector.upsert([{
    id: input.conversationId,
    embedding: input.embedding,
    restricts: { orgId: input.orgId, projectId: input.projectId, kind: 'summary' },
  }]);
}

/** Semantic search over this project's past incident summaries. ANN over the shared vector index
 *  (kind='summary'), then load the matching conversations. Newest-relevance order; excludes the
 *  current conversation. Mirrors recallMemories (agent-memories.ts). */
export async function searchRecentSummaries(
  store: Store,
  input: { orgId: string; projectId: string; queryEmbedding: number[]; excludeConversationId?: string; limit?: number },
): Promise<{ id: string; summary: string; status: string }[]> {
  const limit = Math.min(input.limit ?? 5, 10);
  const neighbors = await store.vector.findNeighbors(input.queryEmbedding, {
    limit: limit + 1, // fetch one extra so excluding the current conversation can't shrink the result
    filter: { orgId: [input.orgId], projectId: [input.projectId], kind: ['summary'] },
  });
  const ids = neighbors.map((n) => n.id).filter((id) => id !== input.excludeConversationId).slice(0, limit);
  if (ids.length === 0) return [];
  const snaps = await getAllDocs(store.db, 'conversations', ids);
  const order = new Map(ids.map((id, i) => [id, i] as const));
  return snaps
    .map((s) => fromDoc<Conversation>(s))
    .filter((c) => c.summary !== '')
    .sort((a, b) => (order.get(a.id)! - order.get(b.id)!))
    .map((c) => ({ id: c.id, summary: c.summary, status: c.status }));
}

// ── Teams conversation helpers ──

export type FindOrCreateTeamsInput = {
  orgId: string;
  projectId: string;
  assistantId: string | null;
  teamsTenantId: string;
  teamsConversationId: string;
};

export async function findOrCreateTeamsConversation(db: Db, input: FindOrCreateTeamsInput): Promise<Conversation> {
  const existing = await getTeamsConversation(db, input.teamsTenantId, input.teamsConversationId);
  if (existing) return existing;
  const ref = col(db, 'conversations').doc();
  await ref.set(toDoc(applyDefaults({
    orgId: input.orgId, projectId: input.projectId, assistantId: input.assistantId,
    rootConversationId: null, source: 'teams', status: 'open', summary: '',
    slackChannelId: null, slackThreadTs: null,
    teamsTenantId: input.teamsTenantId, teamsConversationId: input.teamsConversationId,
    createdAt: FieldValue.serverTimestamp(),
  }, ref.id)));
  // Re-read by (tenant, conversation) so a concurrent create resolves to a single winner.
  return (await getTeamsConversation(db, input.teamsTenantId, input.teamsConversationId))!;
}

export async function getTeamsConversation(db: Db, tenantId: string, conversationId: string): Promise<Conversation | null> {
  const snaps = await col(db, 'conversations')
    .where('teamsTenantId', '==', tenantId)
    .where('teamsConversationId', '==', conversationId)
    .limit(1).get();
  return snaps.length === 0 ? null : fromDoc<Conversation>(snaps[0]!);
}

/** Mirror of getSlackRootTarget: resolve the originating Teams thread (walking to the ROOT
 *  conversation) so errors/answers from nested sub-agent turns deliver to the right place.
 *  serviceUrl + placeholderActivityId come from the root's most recent teams turn payload. */
export async function getTeamsRootTarget(
  db: Db, conversationId: string,
): Promise<{ orgId: string; tenantId: string; conversationId: string; serviceUrl?: string; placeholderActivityId?: string } | null> {
  const convo = await getConversation(db, conversationId);
  if (!convo) return null;
  const rootId = convo.rootConversationId ?? convo.id;
  const root = rootId === convo.id ? convo : await getConversation(db, rootId);
  if (!root?.teamsTenantId || !root?.teamsConversationId) return null;
  const snaps = await col(db, 'message_queue')
    .where('laneId', '==', rootId).where('source', '==', 'teams')
    .orderBy('createdAt', 'desc').limit(1).get();
  const latest = snaps.length === 0 ? null : fromDoc<{ payload: unknown }>(snaps[0]!);
  const teams = (latest?.payload as { teams?: { serviceUrl?: string; placeholderActivityId?: string } } | null)?.teams;
  return {
    orgId: root.orgId, tenantId: root.teamsTenantId, conversationId: root.teamsConversationId,
    serviceUrl: teams?.serviceUrl, placeholderActivityId: teams?.placeholderActivityId,
  };
}
