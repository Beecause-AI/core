import type { ToolExecutor } from './types.js';
import type { ToolDef, ToolCall, ToolResult } from '../provider.js';

/** Worker-provided semantic search over past incident summaries (project-scoped). */
export interface RecentSearchClient {
  search(orgId: string, projectId: string, query: string, excludeConversationId: string | undefined, limit?: number): Promise<string>;
}

const SEARCH_DEF: ToolDef = {
  name: 'recent.search',
  description: 'Search THIS project\'s past incidents for ones on the same or a related topic. Pass a short description of the current problem (component, error signature, symptom); returns matching past conversations (id + summary) to correlate against. Use conversations.read on an id to inspect one in detail.',
  kind: 'builtin',
  mutates: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'words describing the current incident / topic to find related past incidents' },
      limit: { type: 'number', description: 'max results (default 5)' },
    },
    required: ['query'],
  },
};

export class RecentSearchToolExecutor implements ToolExecutor {
  constructor(
    private client: RecentSearchClient,
    private orgId: string,
    private projectId: string | undefined,
    private excludeConversationId: string | undefined,
  ) {}

  toToolDefs(names: string[]): ToolDef[] {
    if (!this.projectId) return [];
    return names.includes('recent.search') ? [SEARCH_DEF] : [];
  }

  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    if (!this.projectId) {
      return { toolCallId: call.id, name: call.name, content: 'recent search not available (no project)', isError: true };
    }
    const args = (call.arguments ?? {}) as { query?: unknown; limit?: unknown };
    if (typeof args.query !== 'string' || !args.query.trim()) {
      return { toolCallId: call.id, name: call.name, content: 'query (string) required', isError: true };
    }
    try {
      const content = await this.client.search(
        this.orgId, this.projectId, args.query, this.excludeConversationId,
        typeof args.limit === 'number' ? args.limit : undefined,
      );
      return { toolCallId: call.id, name: call.name, content: content || '(no related incidents)', isError: false };
    } catch (err) {
      return { toolCallId: call.id, name: call.name, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}
