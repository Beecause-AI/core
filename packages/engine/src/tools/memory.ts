import type { ToolExecutor } from './types.js';
import type { ToolDef, ToolCall, ToolResult } from '../provider.js';

/** Worker-provided memory backend: embeds the query + recalls scoped memories, returns formatted text. */
export interface MemoryClient {
  recall(orgId: string, projectId: string, assistantId: string, query: string, limit?: number): Promise<string>;
}

const RECALL_DEF: ToolDef = {
  name: 'memory.recall',
  description: "Recall relevant knowledge learned from past incidents (your own and your team's). Pass a natural-language query describing what you are investigating.",
  kind: 'builtin',
  mutates: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'what you are looking for' },
      limit: { type: 'number', description: 'max memories to return (default 5)' },
    },
    required: ['query'],
  },
};

export class MemoryToolExecutor implements ToolExecutor {
  constructor(
    private client: MemoryClient,
    private orgId: string,
    private projectId: string | undefined,
    private assistantId: string | undefined,
  ) {}

  toToolDefs(names: string[]): ToolDef[] {
    if (!this.projectId || !this.assistantId) return [];
    return names.includes('memory.recall') ? [RECALL_DEF] : [];
  }

  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    if (!this.projectId || !this.assistantId) {
      return { toolCallId: call.id, name: call.name, content: 'memory not available (no project/assistant)', isError: true };
    }
    const args = (call.arguments ?? {}) as { query?: unknown; limit?: unknown };
    if (typeof args.query !== 'string') {
      return { toolCallId: call.id, name: call.name, content: 'query (string) required', isError: true };
    }
    try {
      const content = await this.client.recall(
        this.orgId,
        this.projectId,
        this.assistantId,
        args.query,
        typeof args.limit === 'number' ? args.limit : undefined,
      );
      return { toolCallId: call.id, name: call.name, content: content || '(no relevant memories)', isError: false };
    } catch (err) {
      return { toolCallId: call.id, name: call.name, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}
