export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
  thoughtSignature?: string; // Gemini 3.x: opaque signature that must be echoed when replaying this call
}

/** Provider-agnostic tool definition handed to the model. */
export interface ToolDef {
  name: string;          // namespaced, e.g. 'builtin.add'
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the arguments object
  kind: 'builtin' | 'mcp' | 'agent' | 'integration';
  mutates: boolean;      // write/side-effecting? read tools never gate (used in later phases)
}

/** The outcome of executing a ToolCall, fed back to the model. */
export interface ToolResult {
  toolCallId: string;
  name: string;          // function name (providers that key on name, e.g. Gemini)
  content: string;       // serialized result text
  isError?: boolean;
}

export type ModelEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  // `answer` is the turn's authoritative reply — the agent's last non-empty assistant
  // text (or a graceful fallback). Set by runAgentLoop; consumers post/persist this
  // rather than reconstructing it from the streamed text events.
  | { type: 'done'; finishReason: string; answer?: string }
  | { type: 'awaiting_approval'; calls: ToolCall[] }
  | { type: 'awaiting_subagent'; calls: ToolCall[] };

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[]; // on assistant messages: what the model asked for
  toolCallId?: string;    // on tool messages: which call this answers
  name?: string;          // on tool messages: the function name
}

export interface ModelRequest {
  model: string;
  /** Optional explicit provider from the assistant. When set, entry resolution honors it
   *  ('platform' forces the platform entry; a byok provider forces that key when enabled).
   *  When absent, the engine falls back to BYOK-availability-driven resolution. */
  provider?: string | null;
  messages: ModelMessage[];
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | { name: string };
  maxOutputTokens?: number;
  /** Sampling temperature. Forwarded to the provider's generationConfig/equivalent when set. */
  temperature?: number;
}

/** Resolved per-call auth. The engine injects this; providers stay stateless. */
export interface ProviderContext {
  apiKey: string;
  baseUrl?: string;
}

export interface ModelProvider {
  id: string;
  run(req: ModelRequest, ctx: ProviderContext, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

export type ErrorClass = 'temporary' | 'permanent' | 'rate_limited';

/** Providers throw this so the engine can classify without HTTP-status guessing. */
export class ProviderError extends Error {
  readonly kind: ErrorClass;
  readonly status?: number;
  /** For rate_limited errors: the server-advised back-off (`retry-after`) in ms, when present. */
  readonly retryAfterMs?: number;
  constructor(message: string, kind: ErrorClass, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
