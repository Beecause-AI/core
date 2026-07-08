import type { ToolExecutor } from './types.js';
import type { ToolDef, ToolCall, ToolResult } from '../provider.js';

/** Worker-provided skills backend: returns the body of an attached skill by name (or null). */
export interface SkillClient {
  load(projectId: string, assistantId: string, name: string): Promise<string | null>;
}

const LOAD_DEF: ToolDef = {
  name: 'skill.load',
  description: 'Load the full instructions for one of your attached skills by name. Call this before applying a skill — the names and one-line descriptions are listed in your Skills section.',
  kind: 'builtin',
  mutates: false,
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'the skill name as listed in your Skills section' } },
    required: ['name'],
  },
};

export class SkillToolExecutor implements ToolExecutor {
  constructor(
    private client: SkillClient,
    private projectId: string | undefined,
    private assistantId: string | undefined,
  ) {}

  toToolDefs(names: string[]): ToolDef[] {
    if (!this.projectId || !this.assistantId) return [];
    return names.includes('skill.load') ? [LOAD_DEF] : [];
  }

  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    if (!this.projectId || !this.assistantId) {
      return { toolCallId: call.id, name: call.name, content: 'skills not available (no project/assistant)', isError: true };
    }
    const args = (call.arguments ?? {}) as { name?: unknown };
    if (typeof args.name !== 'string') {
      return { toolCallId: call.id, name: call.name, content: 'name (string) required', isError: true };
    }
    try {
      const body = await this.client.load(this.projectId, this.assistantId, args.name);
      if (body == null) {
        return { toolCallId: call.id, name: call.name, content: `no skill named "${args.name}" is attached to you`, isError: false };
      }
      return { toolCallId: call.id, name: call.name, content: body, isError: false };
    } catch (err) {
      return { toolCallId: call.id, name: call.name, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}
