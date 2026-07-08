import type { ToolCall, ToolDef, ToolResult } from '../provider.js';
import type { ToolExecutor } from './types.js';

export interface AgentCard { id: string; name: string; description: string; }

/** Lists sibling assistants as agent.<id> ToolDefs. execute() is never reached inline —
 *  agent calls SUSPEND the loop (awaiting_subagent) to spawn a child turn. */
export class AgentToolExecutor implements ToolExecutor {
  constructor(private cards: AgentCard[]) {}
  toToolDefs(names: string[]): ToolDef[] {
    const wanted = new Set(names.filter((n) => n.startsWith('agent.')));
    return this.cards
      .filter((c) => wanted.has(`agent.${c.id}`))
      .map((c) => ({
        name: `agent.${c.id}`,
        description: c.description || c.name,
        kind: 'agent' as const,
        mutates: false,
        parameters: { type: 'object', properties: { input: { type: 'string', description: 'the task for the sub-agent' } }, required: ['input'] },
      }));
  }
  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    return { toolCallId: call.id, name: call.name, content: 'agent tool must be invoked via sub-agent suspend', isError: true };
  }
}
