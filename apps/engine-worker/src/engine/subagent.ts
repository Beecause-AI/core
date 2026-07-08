import {
  createAgentRun,
  getAgentRun,
  getTurn,
  resolveAgentRunIfSuspended,
  recordAgentRunResult,
  getAssistant,
  getOrgById,
  getSystemAgent,
  createConversation,
  countChildConversations,
  enqueueTurn,
  listConversationMessages,
  listAttachedSkills,
  renderSkillsBlock,
  type Db,
  type QueuedTurn,
} from '@intellilabs/core';
import type { ModelMessage, ToolCall } from '@intellilabs/engine';
import { toolGuidanceBlocks } from '@intellilabs/engine';

export const MAX_SUBAGENT_DEPTH = 4;

/** The lead orchestrator always gets conversations.read so it can drill into a correlated incident. */
export function leadEnabledTools(baseTools: string[], isLead: boolean): string[] {
  if (!isLead || baseTools.includes('conversations.read')) return baseTools;
  return [...baseTools, 'conversations.read'];
}

/** The recent.search directive injection (and the lead's recent.search grant) fire only at the FIRST turn of a NEW incident: a root → lead handoff where
 *  the root conversation has no child conversations yet. A reused root (e.g. a Slack thread follow-up)
 *  already has children from the prior turn, so it is skipped — preventing the directive from being re-injected per message. */
export function isIncidentStart(parentDepth: number, isLead: boolean, priorChildCount: number): boolean {
  return parentDepth === 0 && isLead && priorChildCount === 0;
}

/** A lead may consult past incidents: expose recent.search when the org has hindsight enabled. */
export function leadSearchTools(baseTools: string[], isLead: boolean, enabled: boolean): string[] {
  if (!isLead || !enabled || baseTools.includes('recent.search')) return baseTools;
  return [...baseTools, 'recent.search'];
}

/** Max analysis-fleet delegations per team-gen run — backstop against runaway over-delegation
 *  (the prod 8x-code + 8x-cloudflare failure). Scoped to agent.sys.analysis.* only, so runtime
 *  RCA teams are unaffected. The broad-mandate persona keeps normal runs well under this. */
export const MAX_FLEET_DELEGATIONS = 8;

/** Linkage from a sub-agent conversation's turn back to the turn that delegated to it. Must be
 *  carried on EVERY turn of the conversation (including resume turns) — otherwise a multi-level
 *  delegation (Slack → orchestrator → specialist) loses the trail and the orchestrator's final
 *  answer never propagates back up to the originating Slack thread. */
type ParentLink = {
  parentAgentRunId?: string;
  parentCallId?: string;
  parentProjectId?: string;
  parentAssistantId?: string;
};
function parentLink(payload: unknown): ParentLink {
  const p = (payload ?? {}) as ParentLink;
  return {
    parentAgentRunId: p.parentAgentRunId,
    parentCallId: p.parentCallId,
    parentProjectId: p.parentProjectId,
    parentAssistantId: p.parentAssistantId,
  };
}

/** Team-gen orchestrator context that MUST survive EVERY resume turn. bootstrap.ts gates
 *  team.submit_proposal on `proposalId`, and the fleet operation is finalized by `operationId`;
 *  dropping these on resume is what made submit fail with "unknown tool". Carried verbatim from the
 *  suspended (orchestrator) turn's payload. Harmless (all-undefined) for ordinary delegations. */
type Carried = { proposalId?: string; systemAgentKey?: string; rootConversationId?: string; operationId?: string };
function carryForward(payload: unknown): Carried {
  const p = (payload ?? {}) as Carried;
  return { proposalId: p.proposalId, systemAgentKey: p.systemAgentKey, rootConversationId: p.rootConversationId, operationId: p.operationId };
}

type ParentPayload = ParentLink & Carried & {
  model?: string;
  enabledTools?: string[];
  projectId?: string;
  assistantId?: string;
  slack?: unknown;
  depth?: number;
};

type StoredResults = Record<string, { result: string; childConversationId?: string }>;

/** Everything needed to spawn the next sibling child and, when done, resume the parent — sourced
 *  from the delegating turn (makeOnSubagent) or reconstructed from a finished child turn + its run
 *  (resumeParentForChild), so the sequential fan-out can continue from either entry point. */
type FanCtx = {
  runId: string;
  parentLaneId: string;
  orgId: string;
  projectId?: string;
  parentAssistantId?: string;
  parentDepth: number;
  rootConversationId: string;
};

const publishedSource = (slack: unknown): 'slack' | 'internal' => (slack ? 'slack' : 'internal');

/** Spawn ONE child turn for a single agent call. Returns true when a child turn was enqueued (the
 *  fan-out then waits for it); false when the call resolved immediately (unknown agent / depth cap)
 *  — in which case its result is already recorded on the run and the caller moves on. */
async function spawnChildFor(
  db: Db, publish: (laneId: string, turnId: string) => Promise<void>, ctx: FanCtx, call: ToolCall,
): Promise<boolean> {
  const childId = call.name.slice('agent.'.length);

  // Backstop against runaway fleet delegation: once the orchestrator has delegated enough analysis
  // specialists, refuse further ones and tell it to submit. Scoped to agent.sys.analysis.* so
  // runtime RCA teams (regular agent.* / slack system agents) are never constrained.
  if (childId.startsWith('sys.analysis.') && (await countChildConversations(db, ctx.rootConversationId)) >= MAX_FLEET_DELEGATIONS) {
    await recordAgentRunResult(db, ctx.runId, call.id, `Delegation cap (${MAX_FLEET_DELEGATIONS}) reached — you have enough findings; synthesize the team now and call team.submit_proposal.`);
    return false;
  }
  const input = (((call.arguments as { input?: unknown })?.input) ?? '').toString();
  const childPayloadBase = {
    depth: ctx.parentDepth + 1,
    rootConversationId: ctx.rootConversationId,
    parentAgentRunId: ctx.runId,
    parentCallId: call.id,
    parentProjectId: ctx.projectId,
    parentAssistantId: ctx.parentAssistantId,
  };

  // ── system-agent branch (agent.sys.<key>) ──
  if (childId.startsWith('sys.')) {
    const key = childId.slice('sys.'.length);
    const sys = getSystemAgent(key);
    if (!sys) {
      await recordAgentRunResult(db, ctx.runId, call.id, `Unknown system agent: ${key}.`);
      return false;
    }
    const childConvo = await createConversation(db, {
      orgId: ctx.orgId, projectId: ctx.projectId!, assistantId: null, source: 'internal', rootConversationId: ctx.rootConversationId, parentConversationId: ctx.parentLaneId, systemAgentKey: key,
    });
    const childTurn = await enqueueTurn(db, {
      laneId: childConvo.id, orgId: ctx.orgId, source: 'internal',
      payload: {
        model: sys.model, provider: 'platform',
        messages: [{ role: 'system', content: sys.persona }, { role: 'user', content: input }],
        enabledTools: sys.tools, projectId: ctx.projectId, assistantId: null, systemAgentKey: sys.key,
        ...childPayloadBase,
      },
    });
    await publish(childConvo.id, childTurn.id);
    return true;
  }

  // ── regular assistant ──
  const child = ctx.projectId ? await getAssistant(db, ctx.projectId, childId) : null;
  if (!child) {
    await recordAgentRunResult(db, ctx.runId, call.id, 'Unknown sub-agent.');
    return false;
  }
  const attachedSkills = await listAttachedSkills(db, child.id);
  const skillsBlock = renderSkillsBlock(attachedSkills);
  const baseTools = child.enabledTools ?? [];
  const withSkill = attachedSkills.length > 0 && !baseTools.includes('skill.load')
    ? [...baseTools, 'skill.load']
    : baseTools;
  const hindsightEnabled = child.isLead ? !!(await getOrgById(db, ctx.orgId))?.hindsightEnabled : false;
  const childEnabledTools = leadSearchTools(leadEnabledTools(withSkill, child.isLead), child.isLead, hindsightEnabled);

  const messages: ModelMessage[] = [
    { role: 'system', content: child.persona },
    ...(skillsBlock ? [{ role: 'system' as const, content: skillsBlock }] : []),
  ];
  // Flat-tool usage guidance from the registry: `always`-cadence tools (memory.recall) on every
  // turn; `incidentStart` tools (recent.search) only at the first turn of a new incident, so Slack
  // follow-ups aren't re-nudged.
  const priorChildren = await countChildConversations(db, ctx.rootConversationId);
  const incidentStart = isIncidentStart(ctx.parentDepth, child.isLead, priorChildren);
  for (const content of toolGuidanceBlocks(childEnabledTools, { incidentStart })) {
    messages.push({ role: 'system', content });
  }
  messages.push({ role: 'user', content: input });

  const childConvo = await createConversation(db, {
    orgId: ctx.orgId, projectId: ctx.projectId!, assistantId: child.id, source: 'internal', rootConversationId: ctx.rootConversationId, parentConversationId: ctx.parentLaneId,
  });
  const childTurn = await enqueueTurn(db, {
    laneId: childConvo.id, orgId: ctx.orgId, source: 'internal',
    payload: {
      model: child.model, provider: child.provider ?? null,
      messages,
      enabledTools: childEnabledTools, projectId: ctx.projectId, assistantId: child.id,
      ...childPayloadBase,
    },
  });
  await publish(childConvo.id, childTurn.id);
  return true;
}

/** Spawn the next not-yet-resolved call; if every call is resolved (each child finished, or
 *  resolved immediately), resume the parent ONCE with all results. */
async function dispatchOrResume(
  db: Db, publish: (laneId: string, turnId: string) => Promise<void>, ctx: FanCtx, calls: ToolCall[], resolved: Set<string>,
): Promise<void> {
  for (const call of calls) {
    if (resolved.has(call.id)) continue;
    const spawned = await spawnChildFor(db, publish, ctx, call);
    if (spawned) return;       // wait for it; its completion re-enters here for the next call
    resolved.add(call.id);     // resolved immediately (result already recorded) — keep going
  }
  await resumeParent(db, publish, ctx, calls);
}

/** Resolve the bridge and enqueue the parent's resume with EVERY call's gathered result. */
async function resumeParent(
  db: Db, publish: (laneId: string, turnId: string) => Promise<void>, ctx: FanCtx, calls: ToolCall[],
): Promise<void> {
  const run = await getAgentRun(db, ctx.runId);
  if (!run) return;
  // Atomic: only the transition out of 'suspended' enqueues the resume (guards redelivery).
  if (!(await resolveAgentRunIfSuspended(db, run.id, { status: 'resolved' }))) return;

  const stored = (run.results ?? {}) as StoredResults;
  const subagentResults: Record<string, string> = {};
  const childConversationIds: Record<string, string> = {};
  for (const c of calls) {
    subagentResults[c.id] = stored[c.id]?.result ?? '(sub-agent returned nothing)';
    const cid = stored[c.id]?.childConversationId;
    if (cid) childConversationIds[c.id] = cid;
  }

  // Carry the parent conversation's OWN upstream linkage forward (it may itself be a sub-agent),
  // so its eventual final answer propagates all the way up to the originating Slack thread.
  const suspendTurn = await getTurn(db, run.turnId);
  const upstream = parentLink(suspendTurn?.payload);

  const resume = await enqueueTurn(db, {
    laneId: run.laneId, orgId: run.orgId, source: publishedSource(run.slack),
    payload: {
      resume: true, agentRunId: run.id, model: run.model, messages: run.messages, enabledTools: run.enabledTools,
      projectId: ctx.projectId, assistantId: ctx.parentAssistantId, slack: run.slack, depth: run.depth,
      subagentResults, childConversationIds, ...upstream, ...carryForward(suspendTurn?.payload),
    },
  });
  await publish(run.laneId, resume.id);
}

/** EngineDeps.onSubagent: persist the parent bridge, then drive a SEQUENTIAL fan-out over every
 *  agent call in the batch — each child runs in turn and its result is gathered, and the parent
 *  resumes only once ALL calls have a result. Depth cap → resume immediately with an error. */
export function makeOnSubagent(db: Db, publish: (laneId: string, turnId: string) => Promise<void>) {
  return async (turn: QueuedTurn, data: { messages: ModelMessage[]; calls: ToolCall[] }): Promise<void> => {
    const p = turn.payload as ParentPayload;
    const parentDepth = p.depth ?? 0;

    // Depth cap: don't spawn; resume the parent immediately with an error result for all calls.
    if (parentDepth + 1 > MAX_SUBAGENT_DEPTH) {
      const subagentResults = Object.fromEntries(data.calls.map((c) => [c.id, 'Sub-agent depth limit reached; not invoked.']));
      const resume = await enqueueTurn(db, {
        laneId: turn.laneId, orgId: turn.orgId, source: turn.source,
        payload: {
          resume: true, model: p.model, messages: data.messages, enabledTools: p.enabledTools ?? [],
          projectId: p.projectId, assistantId: p.assistantId, slack: p.slack, depth: parentDepth,
          subagentResults, ...parentLink(p), ...carryForward(turn.payload),
        },
      });
      await publish(turn.laneId, resume.id);
      return;
    }

    const run = await createAgentRun(db, {
      turnId: turn.id, laneId: turn.laneId, orgId: turn.orgId,
      messages: data.messages, pendingCalls: data.calls,
      model: p.model ?? '', enabledTools: p.enabledTools ?? [], slack: p.slack ?? null, depth: parentDepth,
    });
    const ctx: FanCtx = {
      runId: run.id, parentLaneId: turn.laneId, orgId: turn.orgId,
      projectId: p.projectId, parentAssistantId: p.assistantId, parentDepth,
      rootConversationId: p.rootConversationId ?? turn.laneId,
    };
    await dispatchOrResume(db, publish, ctx, data.calls, new Set());
  };
}

/** Called from run-turn after a turn finishes 'done'. If the turn was a sub-agent child, record its
 *  result and either spawn the next sibling delegation or resume the parent. Returns true if it
 *  handled a child. */
export async function resumeParentForChild(
  db: Db,
  publish: (l: string, t: string) => Promise<void>,
  childTurn: QueuedTurn,
): Promise<boolean> {
  const cp = childTurn.payload as ParentLink & { rootConversationId?: string };
  if (!cp.parentAgentRunId || !cp.parentCallId) return false;

  const run = await getAgentRun(db, cp.parentAgentRunId);
  if (!run || run.status !== 'suspended') return true; // already fully resolved (or gone)

  const stored = (run.results ?? {}) as StoredResults;
  if (stored[cp.parentCallId] !== undefined) return true; // idempotent: this child already recorded

  // A child that didn't finish 'done' (failed / cancelled) must STILL resume the parent — with a
  // clear failure note rather than an empty result — so the orchestrator can react (retry, route
  // around it, or report the gap) instead of being orphaned waiting on a child that never returns.
  const childFailed = childTurn.status === 'failed' || childTurn.status === 'cancelled';
  const childText = childFailed
    ? `Sub-agent did not complete (${childTurn.status}) — it was unable to produce a result. Proceed without it or report the gap to the user.`
    : ([...(await listConversationMessages(db, childTurn.laneId))].reverse().find((m) => m.role === 'assistant')?.content ?? '(no response)');
  await recordAgentRunResult(db, run.id, cp.parentCallId, childText, childTurn.laneId);

  const ctx: FanCtx = {
    runId: run.id, parentLaneId: run.laneId, orgId: run.orgId,
    projectId: cp.parentProjectId, parentAssistantId: cp.parentAssistantId, parentDepth: run.depth,
    rootConversationId: cp.rootConversationId ?? run.laneId,
  };
  const calls = (run.pendingCalls as ToolCall[]) ?? [];
  const resolved = new Set([...Object.keys(stored), cp.parentCallId]);
  await dispatchOrResume(db, publish, ctx, calls, resolved);
  return true;
}
