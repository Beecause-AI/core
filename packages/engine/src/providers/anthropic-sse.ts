import { ProviderError, type ModelEvent, type ModelMessage } from '../provider.js';

const TEMPORARY = [408, 425, 429, 500, 502, 503, 504];

type AnthropicReq = {
  model: string;
  messages: ModelMessage[];
  maxOutputTokens?: number;
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
};

/** Build the Anthropic Messages payload object (system/messages/tools, stream, max_tokens)
 *  WITHOUT the `model` field. Native Anthropic adds `model`; Vertex Model Garden puts the
 *  model in the URL and instead requires `anthropic_version`. The two providers spread the
 *  appropriate field over this shared core. */
export function anthropicMessagesCore(req: AnthropicReq): Record<string, unknown> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        if (!m.toolCallId) throw new Error('tool message missing toolCallId');
        return {
          role: 'user' as const,
          content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        return { role: 'assistant' as const, content: blocks };
      }
      return { role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content };
    });
  return {
    max_tokens: req.maxOutputTokens ?? 4096,
    stream: true,
    ...(system ? { system } : {}),
    ...(req.tools?.length
      ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
      : {}),
    messages,
  };
}

/** Map engine messages to Anthropic's native body: the shared core plus the top-level
 *  `model` field (native Anthropic API; model goes in the body, not the URL). */
export function toAnthropicBody(req: AnthropicReq): string {
  return JSON.stringify({ model: req.model, ...anthropicMessagesCore(req) });
}

/** Vertex Model Garden body: the shared core MINUS `model` (it lives in the URL) PLUS
 *  the required `anthropic_version` discriminator. */
export function toVertexAnthropicBody(req: AnthropicReq): string {
  return JSON.stringify({ anthropic_version: 'vertex-2023-10-16', ...anthropicMessagesCore(req) });
}

/** Parse a `retry-after` header (RFC 7231 delta-seconds form) to milliseconds, or undefined.
 *  Anthropic emits integer seconds; the HTTP-date form is ignored (treated as absent). */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header.trim());
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

/** Drain the body and throw a classified ProviderError for a non-2xx response. A 429 is
 *  surfaced as `rate_limited` with the server-advised `retry-after` so the breaker can back
 *  off for exactly as long as instructed. */
export async function throwAnthropicError(res: Response): Promise<never> {
  await res.body?.cancel().catch(() => {});
  if (res.status === 429) {
    throw new ProviderError('anthropic 429', 'rate_limited', 429, parseRetryAfterMs(res.headers.get('retry-after')));
  }
  throw new ProviderError(`anthropic ${res.status}`, TEMPORARY.includes(res.status) ? 'temporary' : 'permanent', res.status);
}

/** Parse an Anthropic Messages SSE stream into ModelEvents. Caller has checked res.ok && res.body. */
export async function* streamAnthropicEvents(res: Response): AsyncGenerator<ModelEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let stop = 'end_turn';
  // Tool-use blocks arrive as start → input_json_delta* → stop, keyed by content block index.
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        let p: any;
        try { p = JSON.parse(data); } catch { continue; }
        if (p.type === 'content_block_start' && p.content_block?.type === 'tool_use') {
          toolBlocks.set(p.index, { id: p.content_block.id, name: p.content_block.name, json: '' });
        } else if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') {
          yield { type: 'text', delta: p.delta.text as string };
        } else if (p.type === 'content_block_delta' && p.delta?.type === 'input_json_delta') {
          const b = toolBlocks.get(p.index);
          if (b) b.json += p.delta.partial_json ?? '';
        } else if (p.type === 'content_block_stop') {
          const b = toolBlocks.get(p.index);
          if (b) {
            let args: unknown = {};
            try { args = b.json ? JSON.parse(b.json) : {}; } catch { args = {}; }
            yield { type: 'tool_call', call: { id: b.id, name: b.name, arguments: args } };
            toolBlocks.delete(p.index);
          }
        } else if (p.type === 'message_delta' && p.delta?.stop_reason) {
          stop = p.delta.stop_reason;
        } else if (p.type === 'error') {
          throw new ProviderError(`anthropic: ${p.error?.message ?? 'stream error'}`, 'permanent');
        } else if (p.type === 'message_stop') {
          yield { type: 'done', finishReason: stop };
          return;
        }
      }
    }
    yield { type: 'done', finishReason: stop };
  } finally {
    reader.cancel().catch(() => {});
  }
}
