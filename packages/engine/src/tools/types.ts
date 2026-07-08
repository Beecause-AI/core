import type { ToolCall, ToolDef, ToolResult } from '../provider.js';

/** A first-party tool implemented in-repo. */
export interface BuiltinTool {
  def: ToolDef;
  /** Execute the call. Throw to signal an error; the registry wraps it as an isError result. */
  run(args: unknown, signal: AbortSignal): Promise<string>;
}

/** What the agent loop needs from a tool source: list defs + execute calls. */
export interface ToolExecutor {
  toToolDefs(names: string[]): ToolDef[] | Promise<ToolDef[]>;
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
}
