// packages/engine/src/run-agent-loop-to-text.ts
import type { ModelProvider, ModelRequest, ProviderContext } from './provider.js';
import type { ToolExecutor } from './tools/types.js';
import { runAgentLoop } from './loop.js';

export interface RunLoopResult { text: string; inputTokens: number; outputTokens: number; }

/** Drives runAgentLoop to its terminal `done`, returning the final answer text and summed usage.
 *  Intended for agents whose tools are ALL inline builtins (so the loop never suspends). If the loop
 *  does suspend (awaiting_subagent / awaiting_approval), returns the text accumulated so far rather
 *  than hanging — a defensive guard; such an agent is misconfigured for this helper. */
export async function runAgentLoopToText(
  baseReq: ModelRequest,
  deps: { provider: ModelProvider; ctx: ProviderContext; tools: ToolExecutor; toolNames: string[]; maxIterations?: number },
  signal: AbortSignal = new AbortController().signal,
): Promise<RunLoopResult> {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const ev of runAgentLoop(
    baseReq,
    { provider: deps.provider, ctx: deps.ctx, tools: deps.tools, toolNames: deps.toolNames, maxIterations: deps.maxIterations },
    signal,
  )) {
    if (ev.type === 'usage') { inputTokens += ev.inputTokens; outputTokens += ev.outputTokens; }
    else if (ev.type === 'done') { text = ev.answer ?? ''; }
    else if (ev.type === 'awaiting_subagent' || ev.type === 'awaiting_approval') break;
  }
  return { text, inputTokens, outputTokens };
}
