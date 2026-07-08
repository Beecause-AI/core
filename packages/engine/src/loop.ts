import type { ModelEvent, ModelMessage, ModelProvider, ModelRequest, ProviderContext, ToolCall } from './provider.js';
import type { ToolExecutor } from './tools/types.js';
import { type TurnTrace, noopTurnTrace } from './trace.js';
import type { ApprovalContext } from './approval.js';

function preview(v: unknown, max = 2000): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else { try { s = JSON.stringify(v); } catch { s = String(v); } }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** A final, non-empty message for a turn that produced no answer, so NO agent ever ends a turn
 *  silently — downstream that surfaces as a useless "(no response)" to a parent agent or the user.
 *  Surfaces the most recent tool failure (when there was one) so the real cause propagates up the
 *  delegation chain instead of being swallowed. */
function gracefulFallback(reason: 'max_iterations' | 'empty', lastToolError?: string): string {
  const lead = reason === 'max_iterations'
    ? "I couldn't reach a conclusion — I ran out of steps before finishing."
    : "I couldn't produce a response.";
  return lastToolError ? `${lead} My tools kept failing — last error: ${lastToolError.slice(0, 300)}` : lead;
}

export interface AgentLoopDeps {
  provider: ModelProvider;
  ctx: ProviderContext;
  tools: ToolExecutor;
  toolNames: string[];      // enabled tool names for this assistant
  maxIterations?: number;   // default MAX_ITERATIONS
  trace?: TurnTrace;
  approval?: ApprovalContext;
  onState?: (messages: ModelMessage[]) => void;
  /** Results injected by the worker when resuming a suspended sub-agent turn.
   *  Keyed by tool-call id; the loop injects them as tool messages before
   *  the next provider.run. */
  subagentResults?: Record<string, string>;
  /** Child conversation IDs keyed by tool-call id, populated alongside subagentResults
   *  so the trace span can record which child turn produced the result. */
  childConversationIds?: Record<string, string>;
}

export const MAX_ITERATIONS = 12;

/** Drive the model<->tool cycle within one turn. Yields every ModelEvent (text,
 *  tool_call, tool_result, usage) and a single terminal `done`. The provider is
 *  re-invoked after each batch of tool results until the model stops asking for
 *  tools or the iteration cap is hit.
 *
 *  The loop manages model/tool spans only; runConversation owns turnTrace.end
 *  (single end per outcome). */
export async function* runAgentLoop(
  baseReq: ModelRequest,
  deps: AgentLoopDeps,
  signal: AbortSignal,
): AsyncGenerator<ModelEvent> {
  const messages = [...baseReq.messages];
  const toolDefs = await deps.tools.toToolDefs(deps.toolNames);
  const max = deps.maxIterations ?? MAX_ITERATIONS;
  const trace = deps.trace ?? noopTurnTrace;
  const defByName = new Map(toolDefs.map((d) => [d.name, d] as const));
  const approval = deps.approval;
  // Most recent failing tool result — fed into the graceful fallback so a tool-failure storm
  // (e.g. an integration whose auth keeps dropping) ends with a useful message, not silence.
  let lastToolError: string | undefined;
  // The agent's most recent non-empty text across rounds — the turn's authoritative reply.
  // A conclusion written in the SAME round as a (terminal) tool call lives here, so the empty
  // follow-up round the tool call forces doesn't erase it.
  let lastAnswer = '';

  // RESUME-RESOLVE: if the last message is an assistant message with toolCalls
  // and an approval decision is present, resolve the pending batch before looping.
  const last = messages[messages.length - 1];
  if (approval?.decision && last?.role === 'assistant' && last.toolCalls?.length) {
    for (const call of last.toolCalls) {
      const toolSpan = trace.startToolCall(call.name, defByName.get(call.name)?.kind);
      if (approval.decision === 'denied') {
        const content = 'Tool call denied by the user.';
        toolSpan.end('ok', {});
        messages.push({ role: 'tool', content, toolCallId: call.id, name: call.name });
        yield { type: 'tool_result', result: { toolCallId: call.id, name: call.name, content, isError: true } };
      } else {
        const result = await deps.tools.execute(call, signal);
        toolSpan.end(result.isError ? 'error' : 'ok', {
          error: result.isError ? result.content : undefined,
          argsPreview: preview(call.arguments),
          resultPreview: preview(result.content),
          args: JSON.stringify(call.arguments),
          result: result.content,
        });
        messages.push({ role: 'tool', content: result.content, toolCallId: result.toolCallId, name: result.name });
        yield { type: 'tool_result', result };
      }
    }
  }

  // RESUME-RESOLVE (sub-agent): subagentResults present → inject them as tool messages for the
  // pending assistant tool-call batch. A mixed batch (agent + non-agent calls) already has tool
  // messages appended for its non-agent calls before the suspend, so the assistant batch is NOT
  // necessarily the last message — locate it, and skip any call already answered.
  // Mutually exclusive with the approval block above (no approval.decision on a subagent resume).
  const pendingBatch = deps.subagentResults
    ? [...messages].reverse().find((m) => m.role === 'assistant' && m.toolCalls?.length)
    : undefined;
  if (deps.subagentResults && pendingBatch?.toolCalls?.length) {
    // Only tool results AFTER the pending batch count as "already answered". Tool-call ids are NOT
    // unique across model calls (gemini-sse restarts its counter per stream, so an earlier
    // memory.recall and a later delegate can BOTH be "call_0"), so a whole-history scan would
    // false-positive and skip injecting the delegate's result — leaving the parent with an
    // unanswered delegation and no way to conclude.
    const batchIdx = messages.lastIndexOf(pendingBatch);
    const answered = new Set(messages.slice(batchIdx + 1).filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    for (const call of pendingBatch.toolCalls) {
      const isAgent = defByName.get(call.name)?.kind === 'agent' || call.name.startsWith('agent.');
      if (!isAgent || answered.has(call.id)) continue;
      const content = deps.subagentResults[call.id] ?? '(sub-agent returned nothing)';
      const toolSpan = trace.startToolCall(call.name, 'agent');
      toolSpan.end('ok', { resultPreview: preview(content), result: content, childConversationId: deps.childConversationIds?.[call.id] });
      messages.push({ role: 'tool', content, toolCallId: call.id, name: call.name });
      yield { type: 'tool_result', result: { toolCallId: call.id, name: call.name, content } };
    }
  }

  for (let i = 0; i < max; i++) {
    const req: ModelRequest = { ...baseReq, messages, tools: toolDefs.length ? toolDefs : undefined };
    const calls: ToolCall[] = [];
    let assistantText = '';
    let finish = 'stop';

    const modelSpan = trace.startModelCall(baseReq.model);
    try {
      for await (const ev of deps.provider.run(req, deps.ctx, signal)) {
        if (signal.aborted) { modelSpan.end('ok'); return; }
        if (ev.type === 'text') { assistantText += ev.delta; yield ev; }
        else if (ev.type === 'tool_call') { calls.push(ev.call); yield ev; }
        else if (ev.type === 'usage') { modelSpan.setUsage(ev.inputTokens, ev.outputTokens); yield ev; }
        else if (ev.type === 'done') { finish = ev.finishReason; }
        // tool_result is never produced by a provider; only by this loop.
      }
    } catch (err) {
      modelSpan.end('error', err instanceof Error ? err.message : String(err));
      throw err;
    }
    modelSpan.end('ok');
    if (assistantText.trim()) lastAnswer = assistantText;

    if (calls.length === 0) {
      // Turn is ending. The authoritative reply is the agent's last non-empty text across the
      // whole turn; fall back to a non-empty message only when it produced nothing at all.
      const answer = lastAnswer.trim() || gracefulFallback('empty', lastToolError);
      yield { type: 'done', finishReason: finish, answer };
      return;
    }

    messages.push({ role: 'assistant', content: assistantText, toolCalls: calls });

    // SUSPEND (sub-agent): sub-agent calls cannot run inline — suspend to spawn a child turn.
    // This precedes the approval gate so agent calls never reach approval/execute.
    const agentCalls = calls.filter((c) => defByName.get(c.name)?.kind === 'agent');
    if (agentCalls.length > 0) {
      // MIXED BATCH: a single model turn may emit agent.* delegations alongside ordinary
      // (non-agent) tool calls. Resolve the non-agent calls inline BEFORE suspending so the
      // saved assistant turn ends up with a tool result for every functionCall — otherwise the
      // resumed turn has more functionCall parts than functionResponse parts and the provider
      // (Gemini) rejects it with a function call/response-count mismatch. Skip approval-gated
      // calls: those keep their existing behavior (they cannot run without an approval decision).
      for (const call of calls) {
        if (defByName.get(call.name)?.kind === 'agent') continue;
        if (approval?.required(call.name, defByName.get(call.name)?.mutates ?? false)) continue;
        const toolSpan = trace.startToolCall(call.name, defByName.get(call.name)?.kind);
        const result = await deps.tools.execute(call, signal);
        toolSpan.end(result.isError ? 'error' : 'ok', {
          error: result.isError ? result.content : undefined,
          argsPreview: preview(call.arguments),
          resultPreview: preview(result.content),
          args: JSON.stringify(call.arguments),
          result: result.content,
        });
        if (result.isError) lastToolError = result.content;
        messages.push({ role: 'tool', content: result.content, toolCallId: result.toolCallId, name: result.name });
        yield { type: 'tool_result', result };
      }
      deps.onState?.(messages);
      yield { type: 'awaiting_subagent', calls: agentCalls };
      return;
    }

    // SUSPEND: if any call in this batch requires approval, emit awaiting_approval and return.
    const gated = approval ? calls.some((c) => approval.required(c.name, defByName.get(c.name)?.mutates ?? false)) : false;
    if (gated) {
      deps.onState?.(messages);
      yield { type: 'awaiting_approval', calls };
      return;
    }

    for (const call of calls) {
      const toolSpan = trace.startToolCall(call.name, defByName.get(call.name)?.kind);
      const result = await deps.tools.execute(call, signal);
      toolSpan.end(result.isError ? 'error' : 'ok', {
        error: result.isError ? result.content : undefined,
        argsPreview: preview(call.arguments),
        resultPreview: preview(result.content),
        args: JSON.stringify(call.arguments),
        result: result.content,
      });
      if (result.isError) lastToolError = result.content;
      messages.push({ role: 'tool', content: result.content, toolCallId: result.toolCallId, name: result.name });
      yield { type: 'tool_result', result };
    }
  }

  // Iteration cap hit. Surface the last real text the agent produced if any, else a graceful
  // "ran out of steps" message — so the turn never resolves to "(no response)".
  const answer = lastAnswer.trim() || gracefulFallback('max_iterations', lastToolError);
  yield { type: 'done', finishReason: 'max_iterations', answer };
}
