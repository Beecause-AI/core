import type { Db } from '../db/client.js';
import { getOperation } from '../repos/operations.js';
import { getConversationTree } from '../repos/conversations.js';
import { listFullModelInvocations } from '../repos/model-invocations.js';
import { listTracesByConversationId, listTraceSteps } from '../repos/traces.js';
import { listActiveTurns } from '../repos/message-queue.js';
import { listSuspendedRuns } from '../repos/agent-runs.js';
import { listAssistants } from '../repos/assistants.js';
import { TEAM_AUTOGEN_PHASES } from '../team/phases.js';
import type { Conversation, ModelInvocation } from '../db/schema.js';

export type RunStep = {
  id: string;
  at: string;                      // ISO timestamp
  kind: 'model' | 'tool';
  name: string;
  phase: string | null;
  status: string;
  conversationId: string | null;
  depth: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  latencyMs: number | null;
  input: unknown | null;           // model: messages[] | tool: args string
  output: string | null;           // model: output | tool: result
  truncated: boolean;
  error: string | null;
};

/** An in-flight unit of work in a conversation tree — a queued/running turn, or a conversation
 *  parked waiting on a delegated sub-agent (a2a). Drives the live "what's happening now?" view. */
export type PendingWork = {
  conversationId: string;
  depth: number;
  state: 'queued' | 'running' | 'suspended';
  label: string;          // assistant/role name, or the front-door source
  detail: string | null;  // e.g. 'awaiting sub-agent', or the turn source
};

export type RunTimeline = {
  kind: 'operation' | 'conversation';
  status: string;
  title: string;
  startedAt: string | null;
  finishedAt: string | null;
  totals: { inputTokens: number; outputTokens: number; costUsd: string };
  phases?: { key: string }[];
  steps: RunStep[];
  /** Live state of the tree: whether anything is in flight, and the pending units (incl. a2a). */
  live: { active: boolean; pending: PendingWork[] };
};

const num = (n: number | null | undefined) => (n == null ? 0 : n);

/** Compute the live in-flight state of a conversation tree from the durable queue + suspended
 *  sub-agent bridges. This is what tells the run page whether a prompt is actually running, what is
 *  queued, and which delegations are still pending — instead of assuming a run is "done". */
async function computeLive(db: Db, root: Conversation, children: Conversation[]): Promise<{ active: boolean; pending: PendingWork[] }> {
  const lanes = [root.id, ...children.map((c) => c.id)];
  const depthOf = new Map<string, number>([[root.id, 0], ...children.map((c) => [c.id, 1] as const)]);
  const convAssistant = new Map<string, string | null>([[root.id, root.assistantId], ...children.map((c) => [c.id, c.assistantId] as const)]);
  const sourceOf = new Map<string, string>([[root.id, root.source], ...children.map((c) => [c.id, c.source] as const)]);
  const [active, suspended, assistants] = await Promise.all([
    listActiveTurns(db, lanes),
    listSuspendedRuns(db, lanes),
    listAssistants(db, root.projectId),
  ]);
  const nameById = new Map(assistants.map((a) => [a.id, a.name] as const));
  const labelFor = (cid: string): string => {
    const aid = convAssistant.get(cid);
    if (aid) return nameById.get(aid) ?? 'assistant';
    return sourceOf.get(cid) === 'slack' ? 'Slack intake' : 'system agent';
  };
  const pending: PendingWork[] = [
    ...active.map((t) => ({ conversationId: t.laneId, depth: depthOf.get(t.laneId) ?? 0, state: t.status as 'queued' | 'running', label: labelFor(t.laneId), detail: t.source })),
    ...suspended.map((r) => ({ conversationId: r.laneId, depth: depthOf.get(r.laneId) ?? 0, state: 'suspended' as const, label: labelFor(r.laneId), detail: 'awaiting sub-agent' })),
  ];
  return { active: pending.length > 0, pending };
}

function modelStep(iv: ModelInvocation, depth: number): RunStep {
  return {
    id: iv.id, at: iv.createdAt.toISOString(), kind: 'model',
    name: iv.source && iv.source !== 'conversation' ? iv.source : iv.model,
    phase: iv.phase, status: iv.status, conversationId: iv.conversationId, depth,
    inputTokens: iv.inputTokens, outputTokens: iv.outputTokens, costUsd: iv.costUsd, latencyMs: iv.latencyMs,
    input: iv.messages ?? null, output: iv.output, truncated: iv.truncated, error: iv.error,
  };
}

/** Gather the model + tool steps for a conversation tree (root + sub-agents), sorted by time. */
async function treeStepsFor(db: Db, rootConversationId: string): Promise<RunStep[]> {
  const tree = await getConversationTree(db, rootConversationId);
  if (!tree.root) return [];
  const ids = [tree.root.id, ...tree.children.map((c) => c.id)];
  const depthOf = new Map<string, number>([[tree.root.id, 0], ...tree.children.map((c) => [c.id, 1] as const)]);
  const invs = await listFullModelInvocations(db, { conversationIds: ids });
  const steps: RunStep[] = invs.map((iv) => modelStep(iv, depthOf.get(iv.conversationId ?? '') ?? 0));
  for (const cid of ids) {
    const traces = await listTracesByConversationId(db, cid);
    for (const tr of traces) {
      for (const s of await listTraceSteps(db, tr.id)) {
        if (s.type !== 'tool_call') continue;
        steps.push({
          id: s.id, at: (s.startedAt ?? new Date(0)).toISOString(), kind: 'tool',
          name: s.name, phase: null, status: s.status, conversationId: cid,
          depth: depthOf.get(cid) ?? 0,
          inputTokens: s.inputTokens, outputTokens: s.outputTokens, costUsd: s.costUsd, latencyMs: s.latencyMs,
          input: s.args ?? s.argsPreview ?? null, output: s.result ?? s.resultPreview ?? null,
          truncated: s.truncated, error: s.error,
        });
      }
    }
  }
  return steps.sort((a, b) => a.at.localeCompare(b.at));
}

export async function buildOperationTimeline(db: Db, operationId: string): Promise<RunTimeline | null> {
  const op = await getOperation(db, operationId);
  if (!op) return null;
  const invs = await listFullModelInvocations(db, { operationId });
  const ownSteps = invs.map((iv) => modelStep(iv, 0));
  // Agentic team-gen records its work under a linked conversation tree (not the operation);
  // merge those steps so the operation's run page shows the whole fleet.
  const treeSteps = op.runConversationId ? await treeStepsFor(db, op.runConversationId) : [];
  const steps = [...ownSteps, ...treeSteps].sort((a, b) => a.at.localeCompare(b.at));
  const tree = op.runConversationId ? await getConversationTree(db, op.runConversationId) : null;
  const live = tree?.root ? await computeLive(db, tree.root, tree.children) : { active: false, pending: [] };
  return {
    kind: 'operation',
    status: op.status,
    title: op.kind,
    startedAt: op.startedAt ? op.startedAt.toISOString() : null,
    finishedAt: op.finishedAt ? op.finishedAt.toISOString() : null,
    totals: {
      inputTokens: steps.reduce((s, x) => s + num(x.inputTokens), 0),
      outputTokens: steps.reduce((s, x) => s + num(x.outputTokens), 0),
      costUsd: op.costUsd ?? '0',
    },
    phases: op.kind === 'team-autogen' ? TEAM_AUTOGEN_PHASES.map((key) => ({ key })) : undefined,
    steps,
    live,
  };
}

export async function buildConversationTimeline(db: Db, conversationId: string): Promise<RunTimeline | null> {
  const tree = await getConversationTree(db, conversationId);
  if (!tree.root) return null;
  const steps = await treeStepsFor(db, conversationId);
  // Derive the live status from the queue + suspended bridges instead of assuming 'done' — so the
  // run page shows 'running' (and keeps polling) while a turn is queued/running or a delegation is
  // still pending, and what exactly is in flight.
  const live = await computeLive(db, tree.root, tree.children);
  return {
    kind: 'conversation',
    status: live.active ? 'running' : 'done',
    title: `${tree.root.source} run`,
    startedAt: tree.root.createdAt ? tree.root.createdAt.toISOString() : null,
    finishedAt: null,
    totals: {
      inputTokens: steps.reduce((s, x) => s + num(x.inputTokens), 0),
      outputTokens: steps.reduce((s, x) => s + num(x.outputTokens), 0),
      costUsd: steps.reduce((s, x) => s + Number(x.costUsd ?? 0), 0).toFixed(6),
    },
    steps,
    live,
  };
}
