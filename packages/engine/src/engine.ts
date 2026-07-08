import type { Db, QueuedTurn } from '@intellilabs/core';
import {
  claimNextTurn, markTurnDone, markTurnFailed, markTurnCancelled,
  requeueTurn, isCancelRequested, getBreaker, saveBreaker, recordBreakerFailure,
} from '@intellilabs/core';
import {
  classifyError, canAttempt, onSuccess, onTemporaryFailure, onRateLimit, type Breaker,
} from './breaker.js';
import { ModelRegistry, breakerKeyFor, type CredentialResolver } from './registry.js';
import { watchCancel } from './cancel.js';
import { ProviderError, type ModelEvent, type ModelProvider, type ModelRequest } from './provider.js';
import { recordingProvider, type InvocationRecorder, type RecordMeta } from './recorded-run.js';
import { runAgentLoop } from './loop.js';
import type { ToolExecutor } from './tools/types.js';
import { type TurnTrace, noopTurnTrace } from './trace.js';

export const MAX_ATTEMPTS = 5;
/** Total nacks (provider-call attempts + breaker-open deferrals) we allow before failing a turn
 *  cleanly via a 200-ACK. Kept safely below the Pub/Sub subscription's maxDeliveryAttempts (10)
 *  so a turn held off by a long breaker-open window fails gracefully (and resumes its parent)
 *  instead of being silently dead-lettered. */
export const MAX_DELIVERIES = 8;

export interface EngineDeps {
  db: Db;
  registry: ModelRegistry;
  providers: Map<string, ModelProvider>;     // provider id -> provider
  credentials: CredentialResolver;
  buildRequest: (turn: QueuedTurn) => ModelRequest;
  onEvent?: (turn: QueuedTurn, ev: ModelEvent) => Promise<void> | void;
  /** When present, turns run as an agent loop (model<->tool) instead of a single
   *  provider.run. toolNamesFor selects the enabled tools for the turn.
   *  Either `tools` (static executor) or `toolsFor` (per-turn executor factory) must
   *  be present when agentLoop is set. `toolsFor` takes precedence if both are given. */
  agentLoop?: {
    tools?: ToolExecutor;
    toolsFor?: (turn: QueuedTurn) => ToolExecutor;
    toolNamesFor: (turn: QueuedTurn) => string[];
    maxIterations?: number;
  };
  now?: () => Date;
  /** Org-aware entry resolution (BYOK). Defaults to registry.get when omitted. */
  resolveEntry?: (model: string, orgId: string, provider?: string | null) => Promise<import('./registry.js').ModelEntry>;
  /** drainLane only: supplies a fresh provider per turn (single-use fakes in tests). */
  providerFactory?: () => ModelProvider;
  /** Factory that creates a TurnTrace observer per turn. The engine never imports an OTel SDK. */
  trace?: (turn: QueuedTurn) => TurnTrace;
  /** Factory that creates an ApprovalContext per turn (agent-loop path only). Sync or async. */
  approval?: (turn: QueuedTurn) => import('./approval.js').ApprovalContext | Promise<import('./approval.js').ApprovalContext>;
  /** Called when a turn suspends pending approval. Persists the bridge row. */
  onSuspend?: (turn: QueuedTurn, data: { messages: import('./provider.js').ModelMessage[]; calls: import('./provider.js').ToolCall[] }) => Promise<void>;
  /** Called when a turn suspends pending sub-agent execution. Persists the bridge row. */
  onSubagent?: (turn: QueuedTurn, data: { messages: import('./provider.js').ModelMessage[]; calls: import('./provider.js').ToolCall[] }) => Promise<void>;
  /** Returns injected sub-agent results for a resumed turn, keyed by tool-call id. */
  subagentResultsFor?: (turn: QueuedTurn) => Record<string, string> | undefined;
  /** Returns child conversation ids for a resumed turn, keyed by tool-call id. */
  childConversationIdsFor?: (turn: QueuedTurn) => Record<string, string> | undefined;
  /** Best-effort per-call telemetry. When present, the resolved provider is wrapped
   *  with recordingProvider so EVERY model call in the turn is recorded with full
   *  request messages + output + usage. Returns the recorder + meta, or undefined to
   *  skip recording for this turn. Recording never affects the turn outcome. */
  recorderFor?: (turn: QueuedTurn) => { recorder: InvocationRecorder; meta: RecordMeta } | undefined;
  /** Optional billing guard. When present and it returns true for an end-user turn, the turn is
   *  cancelled before any model call (credits exhausted). Injected by engine-worker; absent in tests. */
  creditsExhausted?: (turn: QueuedTurn) => Promise<boolean>;
}

export type RunOutcome =
  | { kind: 'idle' }
  | { kind: 'done'; turnId: string }
  | { kind: 'failed'; turnId: string }
  | { kind: 'cancelled'; turnId: string }
  | { kind: 'requeued'; turnId: string }
  | { kind: 'breaker_open'; turnId: string }
  | { kind: 'suspended'; turnId: string };

function toBreaker(row: Awaited<ReturnType<typeof getBreaker>>): Breaker | null {
  if (!row) return null;
  return { state: row.state as Breaker['state'], failures: row.failures, openedAt: row.openedAt, nextProbeAt: row.nextProbeAt };
}

async function persistBreaker(db: Db, key: string, b: Breaker): Promise<void> {
  await saveBreaker(db, { key, state: b.state, failures: b.failures, openedAt: b.openedAt, nextProbeAt: b.nextProbeAt });
}

function serializeError(err: unknown): unknown {
  // Persist the classification alongside the message so downstream consumers (e.g. the Slack
  // error delivery) can tell a retryable failure (rate limit / transient) from a permanent one
  // without re-parsing the message. `class` is 'temporary' | 'permanent'.
  const base = err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
  return { ...base, class: classifyError(err) };
}

function isAbort(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

/** Claim and run the next turn for a lane (single-flight). Returns what happened. */
export async function runConversation(deps: EngineDeps, laneId: string): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const claim = await claimNextTurn(deps.db, laneId);
  if (!claim) return { kind: 'idle' };

  // Credits enforcement: inert unless engine-worker injected the predicate AND enforcement is on
  // and the org's balance is empty. A billing error never blocks a turn (treat as not-blocked).
  // Internal sub-agent turns are not gated here (the root turn already was).
  if (deps.creditsExhausted && claim.source !== 'internal') {
    let blocked = false;
    try { blocked = await deps.creditsExhausted(claim); } catch { blocked = false; }
    if (blocked) {
      await markTurnCancelled(deps.db, claim.id);
      return { kind: 'cancelled', turnId: claim.id };
    }
  }

  const req = deps.buildRequest(claim);
  const entry = deps.resolveEntry
    ? await deps.resolveEntry(req.model, claim.orgId, req.provider)
    : deps.registry.get(req.model);
  const breakerKey = breakerKeyFor(entry, claim.orgId);
  const breaker = toBreaker(await getBreaker(deps.db, breakerKey));

  if (!canAttempt(breaker, now())) {
    // Record the deferral as a visible step so the back-off shows on the run timeline (not just
    // the attempts that hit the provider). Best-effort: telemetry never affects the outcome.
    const deferRec = deps.recorderFor?.(claim);
    if (deferRec) {
      try {
        await deferRec.recorder.finish({
          ...deferRec.meta, model: req.model, messages: req.messages, output: '',
          inputTokens: 0, outputTokens: 0, latencyMs: 0, status: 'deferred',
          error: `model call deferred — circuit breaker open (${breaker?.state ?? 'open'}); backing off until next probe`,
        }, null);
      } catch { /* best-effort */ }
    }
    // Defer without counting a provider attempt — but bound total deferrals so a long
    // breaker-open window fails the turn cleanly (parent resumes) before Pub/Sub dead-letters it.
    const deferrals = (claim.deferrals ?? 0) + 1;
    if (claim.attempts + deferrals >= MAX_DELIVERIES) {
      await markTurnFailed(deps.db, claim.id, { reason: 'breaker_open_exhausted', breakerKey });
      return { kind: 'failed', turnId: claim.id };
    }
    await requeueTurn(deps.db, claim.id, { reason: 'breaker_open', breakerKey }, false);
    return { kind: 'breaker_open', turnId: claim.id };
  }

  const resolved = deps.providers.get(entry.provider);
  if (!resolved) {
    await markTurnFailed(deps.db, claim.id, { message: `no provider registered: ${entry.provider}` });
    return { kind: 'failed', turnId: claim.id };
  }
  // Best-effort: wrap with a recording decorator so EVERY model call in this turn
  // is captured (full messages + output + usage). Never affects the turn outcome.
  const rec = deps.recorderFor?.(claim);
  const provider = rec ? recordingProvider(resolved, rec.meta, rec.recorder) : resolved;

  let ctx: Awaited<ReturnType<CredentialResolver['resolve']>>;
  try {
    ctx = await deps.credentials.resolve(entry, claim.orgId);
  } catch (err) {
    await markTurnFailed(deps.db, claim.id, serializeError(err));
    return { kind: 'failed', turnId: claim.id };
  }

  const controller = new AbortController();
  const closeWatch = await watchCancel(deps.db, claim.id, () => controller.abort());
  const turnTrace = deps.trace ? deps.trace(claim) : noopTurnTrace;

  try {
    let capturedMessages: import('./provider.js').ModelMessage[] = [];
    let suspendedCalls: import('./provider.js').ToolCall[] | null = null;
    let subagentCalls: import('./provider.js').ToolCall[] | null = null;

    const approvalCtx = deps.approval ? await deps.approval(claim) : undefined;
    const toolExec = deps.agentLoop
      ? (deps.agentLoop.toolsFor ? deps.agentLoop.toolsFor(claim) : deps.agentLoop.tools)
      : undefined;
    const events = deps.agentLoop
      ? runAgentLoop(req, {
          provider,
          ctx,
          tools: toolExec!,
          toolNames: deps.agentLoop.toolNamesFor(claim),
          maxIterations: deps.agentLoop.maxIterations,
          trace: turnTrace,
          approval: approvalCtx,
          onState: (m) => { capturedMessages = m; },
          subagentResults: deps.subagentResultsFor?.(claim),
          childConversationIds: deps.childConversationIdsFor?.(claim),
        }, controller.signal)
      : provider.run(req, ctx, controller.signal);

    let finishReason = 'stop';
    for await (const ev of events) {
      // Invariant: abort is only ever triggered by watchCancel's onCancel, which fires
      // after requestCancel has transactionally set cancel_requested=true — so the
      // post-loop isCancelRequested check always catches a real abort and marks it
      // cancelled, never done. A future timeout-driven abort would need to set
      // cancel_requested too, or this success path would mismark it as done.
      if (controller.signal.aborted) break;
      if (ev.type === 'done') finishReason = ev.finishReason;
      if (ev.type === 'awaiting_approval') suspendedCalls = ev.calls;
      if (ev.type === 'awaiting_subagent') subagentCalls = ev.calls;
      await deps.onEvent?.(claim, ev);
    }
    if (suspendedCalls) {
      await deps.onSuspend?.(claim, { messages: capturedMessages, calls: suspendedCalls });
      turnTrace.end('ok', 'suspended');
      await markTurnDone(deps.db, claim.id);
      return { kind: 'suspended', turnId: claim.id };
    }
    if (subagentCalls) {
      await deps.onSubagent?.(claim, { messages: capturedMessages, calls: subagentCalls });
      turnTrace.end('ok', 'subagent');
      await markTurnDone(deps.db, claim.id);
      return { kind: 'suspended', turnId: claim.id };
    }
    if (await isCancelRequested(deps.db, claim.id)) {
      turnTrace.end('ok', 'cancelled');
      await markTurnCancelled(deps.db, claim.id);
      return { kind: 'cancelled', turnId: claim.id };
    }
    turnTrace.end('ok', finishReason);
    await markTurnDone(deps.db, claim.id);
    await persistBreaker(deps.db, breakerKey, onSuccess(breaker));
    return { kind: 'done', turnId: claim.id };
  } catch (err) {
    if (isAbort(err) || (await isCancelRequested(deps.db, claim.id))) {
      turnTrace.end('ok', 'cancelled');
      await markTurnCancelled(deps.db, claim.id);
      return { kind: 'cancelled', turnId: claim.id };
    }
    const cls = classifyError(err);
    if (cls === 'temporary' || cls === 'rate_limited') {
      // A 429 carries an authoritative back-off: trip the breaker faster and honor retry-after
      // as the cooldown. Atomic: re-read under the breaker advisory lock and apply the transition,
      // so concurrent failures on the same breaker key across lanes don't lose counts.
      const retryAfterMs = err instanceof ProviderError ? err.retryAfterMs : undefined;
      await recordBreakerFailure(deps.db, breakerKey, (cur) => {
        const b = cls === 'rate_limited'
          ? onRateLimit(toBreaker(cur), now(), retryAfterMs)
          : onTemporaryFailure(toBreaker(cur), now());
        return { state: b.state, failures: b.failures, openedAt: b.openedAt, nextProbeAt: b.nextProbeAt };
      });
      if (claim.attempts + 1 >= MAX_ATTEMPTS) {
        turnTrace.end('error', undefined, err instanceof Error ? err.message : String(err));
        await markTurnFailed(deps.db, claim.id, serializeError(err));
        return { kind: 'failed', turnId: claim.id };
      }
      turnTrace.end('error', 'requeued');
      await requeueTurn(deps.db, claim.id, serializeError(err));
      return { kind: 'requeued', turnId: claim.id };
    }
    turnTrace.end('error', undefined, err instanceof Error ? err.message : String(err));
    await markTurnFailed(deps.db, claim.id, serializeError(err));
    return { kind: 'failed', turnId: claim.id };
  } finally {
    try {
      await closeWatch();
    } catch {
      /* teardown best-effort — must not mask the real turn outcome */
    }
  }
}

/** Process a lane until idle or a turn defers/fails. Stops on requeue/breaker
 *  (retry timing is the dispatcher's job, Plan B). */
export async function drainLane(deps: EngineDeps, laneId: string): Promise<void> {
  for (;;) {
    let stepDeps: EngineDeps = deps;
    if (deps.providerFactory) {
      const p = deps.providerFactory();
      stepDeps = { ...deps, providers: new Map([[p.id, p]]) };
    }
    const outcome = await runConversation(stepDeps, laneId);
    if (outcome.kind !== 'done') return;
  }
}
