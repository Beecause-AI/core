import { ProviderError, type ModelEvent, type ModelMessage } from '../provider.js';

const TEMPORARY = [408, 425, 429, 500, 502, 503, 504];

/** Map engine messages to OpenAI Chat Completions messages array, serializing
 *  tool calls and tool results to their wire format. */
export function toOpenAIBody(req: {
  model: string;
  messages: ModelMessage[];
  maxOutputTokens?: number;
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
}): string {
  const messages = req.messages.map((m) => {
    if (m.role === 'tool') {
      if (!m.toolCallId) throw new Error('tool message missing toolCallId');
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: {
            name: c.name,
            arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
          },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
  return JSON.stringify({
    model: req.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
    ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
  });
}

/** Drain the body and throw a classified ProviderError for a non-2xx response. */
export async function throwOpenAIError(res: Response): Promise<never> {
  await res.body?.cancel().catch(() => {});
  throw new ProviderError(`upstream ${res.status}`, TEMPORARY.includes(res.status) ? 'temporary' : 'permanent', res.status);
}

/** Parse an OpenAI Chat Completions SSE stream into ModelEvents.
 *  Caller must have already checked res.ok && res.body. */
export async function* streamOpenAIEvents(res: Response): AsyncIterable<ModelEvent> {
  let finishReason = 'stop';
  // Accumulate streamed tool_call fragments keyed by delta index.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  // Parse one SSE line and emit any resulting events. Shared between the
  // streaming loop and the end-of-stream flush so the parse/emit logic stays DRY.
  // `.trim()` also strips a trailing '\r' from CRLF-framed servers.
  function* handleLine(line: string): Generator<ModelEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { return; }
    const choice = parsed.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) yield { type: 'text', delta } as ModelEvent;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (parsed.usage) {
      yield { type: 'usage', inputTokens: parsed.usage.prompt_tokens ?? 0, outputTokens: parsed.usage.completion_tokens ?? 0 } as ModelEvent;
    }
    // Accumulate tool_call fragments (no yield here — emitted after stream ends).
    if (Array.isArray(choice?.delta?.tool_calls)) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
    }
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) yield* handleLine(line);
    }
    // Flush a trailing frame left in `buf` when the stream ends without a
    // final newline. Spec-compliant streams end with '\n\n', so buf is empty
    // here and nothing is flushed.
    if (buf.length > 0) yield* handleLine(buf);
    // Emit accumulated tool calls in index order, before the terminal done event.
    for (const idx of [...toolAcc.keys()].sort((a, b) => a - b)) {
      const t = toolAcc.get(idx)!;
      let args: unknown = {};
      try { args = t.args ? JSON.parse(t.args) : {}; } catch { args = {}; }
      yield { type: 'tool_call', call: { id: t.id, name: t.name, arguments: args } } as ModelEvent;
    }
    yield { type: 'done', finishReason } as ModelEvent;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
