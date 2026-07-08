import { ProviderError, type ModelEvent, type ModelMessage } from '../provider.js';

const TEMPORARY = [408, 425, 429, 500, 502, 503, 504];

/** Map engine messages to Gemini contents + systemInstruction. Assistant tool calls
 *  become functionCall parts; tool results become functionResponse parts. */
export function toGeminiContents(messages: ModelMessage[]): { contents: unknown[]; systemInstruction?: unknown } {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents: { role: string; parts: unknown[] }[] = [];
  const isFnResponseTurn = (c?: { role: string; parts: unknown[] }) =>
    !!c && c.role === 'user' && c.parts.length > 0 && c.parts.every((p) => !!p && typeof p === 'object' && 'functionResponse' in p);

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      if (!m.name) throw new Error('tool message missing name (required for Gemini functionResponse)');
      const part = { functionResponse: { name: m.name, response: { result: m.content } } };
      // Gemini requires the number of functionResponse parts to EQUAL the number of functionCall
      // parts in the preceding model turn (parallel function calling). Each tool result is a
      // separate ModelMessage, so MERGE consecutive ones into a single user turn — otherwise a
      // batch of N parallel calls is answered by N separate 1-part user turns and Gemini rejects
      // it with "number of function response parts is equal to the number of function call parts".
      const prev = contents[contents.length - 1];
      if (isFnResponseTurn(prev)) prev!.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls) {
        const part: Record<string, unknown> = { functionCall: { name: c.name, args: c.arguments } };
        if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature;
        parts.push(part);
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  return sys ? { contents, systemInstruction: { parts: [{ text: sys }] } } : { contents };
}

/** JSON request body shared by both Gemini adapters. */
export function geminiBody(req: {
  messages: ModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
}): string {
  const generationConfig: Record<string, number> = {};
  if (req.maxOutputTokens) generationConfig.maxOutputTokens = req.maxOutputTokens;
  if (req.temperature != null) generationConfig.temperature = req.temperature;
  return JSON.stringify({
    ...toGeminiContents(req.messages),
    ...(req.tools?.length
      ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  });
}

/** Read the body and throw a classified ProviderError for a non-2xx response. The body is included
 *  (truncated) so 400s surface their actual reason (e.g. malformed function-call history) in
 *  telemetry instead of an opaque "gemini 400". */
export async function throwGeminiError(res: Response): Promise<never> {
  let detail = '';
  try { detail = (await res.text()).slice(0, 2000); } catch { /* body unreadable — status only */ }
  throw new ProviderError(
    `gemini ${res.status}${detail ? `: ${detail}` : ''}`,
    TEMPORARY.includes(res.status) ? 'temporary' : 'permanent',
    res.status,
  );
}

/** Parse a Gemini streamGenerateContent SSE response into ModelEvents. The response
 *  shape is identical for the Developer API and Vertex, so both adapters share this.
 *  Caller must have already checked res.ok && res.body. */
export async function* streamGeminiEvents(res: Response): AsyncIterable<ModelEvent> {
  let finishReason = 'STOP';
  let callSeq = 0;
  // Parse one SSE line; `.trim()` also strips a trailing '\r' from CRLF servers.
  function* handleLine(line: string): Generator<ModelEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { return; }
    const cand = parsed.candidates?.[0];
    const parts: any[] = cand?.content?.parts ?? [];
    const text: string = parts.map((x: any) => x?.text ?? '').join('');
    if (text.length > 0) yield { type: 'text', delta: text } as ModelEvent;
    for (const part of parts) {
      if (part?.functionCall) {
        yield {
          type: 'tool_call',
          call: {
            id: `call_${callSeq++}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          },
        } as ModelEvent;
      }
    }
    if (cand?.finishReason) finishReason = cand.finishReason;
    if (parsed.usageMetadata) {
      yield { type: 'usage', inputTokens: parsed.usageMetadata.promptTokenCount ?? 0, outputTokens: parsed.usageMetadata.candidatesTokenCount ?? 0 } as ModelEvent;
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
    if (buf.length > 0) yield* handleLine(buf); // trailing frame w/o final newline
    yield { type: 'done', finishReason } as ModelEvent;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
