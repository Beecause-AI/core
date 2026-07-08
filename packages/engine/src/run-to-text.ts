import type { ModelProvider, ModelRequest, ProviderContext } from './provider.js';

export interface RunToTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Drives a streaming ModelProvider.run to completion, concatenating text
 *  output and summing token usage. For non-interactive callers that need the
 *  whole answer, not a stream. */
export async function runToText(
  provider: ModelProvider,
  req: ModelRequest,
  ctx: ProviderContext,
  signal: AbortSignal = new AbortController().signal,
): Promise<RunToTextResult> {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const ev of provider.run(req, ctx, signal)) {
    if (ev.type === 'text') {
      text += ev.delta;
    } else if (ev.type === 'usage') {
      inputTokens += ev.inputTokens;
      outputTokens += ev.outputTokens;
    }
  }
  return { text, inputTokens, outputTokens };
}
