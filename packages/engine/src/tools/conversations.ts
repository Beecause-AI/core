import type { ToolExecutor } from './types.js';
import type { ToolDef, ToolCall, ToolResult } from '../provider.js';

/** Worker-provided conversation-reading backend (project-scoped). Returns null when the
 *  conversation is not found OR not in the given project — the executor maps that to an error. */
export interface ConversationsReadClient {
  read(projectId: string, conversationId: string): Promise<string | null>;
}

const READ_DEF: ToolDef = {
  name: 'conversations.read',
  description: 'Read the full thread of another conversation in THIS project by id (e.g. one surfaced by recent.search), to inspect a past incident in detail.',
  kind: 'builtin',
  mutates: false,
  parameters: {
    type: 'object',
    properties: { conversationId: { type: 'string', description: 'the conversation id to read' } },
    required: ['conversationId'],
  },
};

/** Formats conversation messages into a capped, role-prefixed transcript. */
export function formatTranscript(rows: { role: string; content: string }[], maxChars = 6000): string {
  const out = rows.map((m) => `${m.role}: ${m.content}`).join('\n');
  return out.length > maxChars ? out.slice(0, maxChars - 1) + '…' : out;
}

export class ConversationsReadToolExecutor implements ToolExecutor {
  constructor(private client: ConversationsReadClient, private projectId: string | undefined) {}

  toToolDefs(names: string[]): ToolDef[] {
    if (!this.projectId) return [];
    return names.includes('conversations.read') ? [READ_DEF] : [];
  }

  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    if (!this.projectId) {
      return { toolCallId: call.id, name: call.name, content: 'conversations.read not available (no project)', isError: true };
    }
    const id = (call.arguments as { conversationId?: unknown } | undefined)?.conversationId;
    if (typeof id !== 'string' || !id) {
      return { toolCallId: call.id, name: call.name, content: 'conversationId is required', isError: true };
    }
    try {
      const content = await this.client.read(this.projectId, id);
      if (content == null) {
        return { toolCallId: call.id, name: call.name, content: 'conversation not found in this project', isError: true };
      }
      return { toolCallId: call.id, name: call.name, content: content || '(conversation has no messages)', isError: false };
    } catch (err) {
      return { toolCallId: call.id, name: call.name, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}
