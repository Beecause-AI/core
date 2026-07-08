import type { ToolCall, ToolDef, ToolResult } from '../provider.js';
import type { BuiltinTool, ToolExecutor } from './types.js';

/** In-repo built-in tools, addressed by their namespaced def.name. */
export class ToolRegistry implements ToolExecutor {
  private readonly byName = new Map<string, BuiltinTool>();
  constructor(tools: BuiltinTool[]) {
    for (const t of tools) this.byName.set(t.def.name, t);
  }

  toToolDefs(names: string[]): ToolDef[] {
    const out: ToolDef[] = [];
    for (const n of names) {
      const t = this.byName.get(n);
      if (t) out.push(t.def);
    }
    return out;
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const tool = this.byName.get(call.name);
    if (!tool) {
      return { toolCallId: call.id, name: call.name, content: `unknown tool: ${call.name}`, isError: true };
    }
    try {
      const content = await tool.run(call.arguments, signal);
      return { toolCallId: call.id, name: call.name, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { toolCallId: call.id, name: call.name, content: message, isError: true };
    }
  }
}
