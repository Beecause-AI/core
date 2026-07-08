import type { ToolCall, ToolDef, ToolResult } from '../provider.js';
import type { ToolExecutor } from './types.js';

/** Per-turn invocation context forwarded to the server (generic; today only Slack
 *  populates it, so a slack-triggered turn can reply in its own thread). */
export interface IntegrationContext {
  slackThread?: { channel: string; threadTs: string };
}

/** Engine-side client to the server's integration tool API. */
export interface IntegrationToolsClient {
  listTools(orgId: string, projectId: string, context?: IntegrationContext): Promise<ToolDef[]>;
  callTool(orgId: string, projectId: string, name: string, args: unknown, context?: IntegrationContext): Promise<{ content: string; isError?: boolean }>;
}

/** ToolExecutor for integration.* tools, backed by the server. org+project (and any
 *  per-turn context, e.g. the triggering Slack thread) bound per turn. */
export class IntegrationToolExecutor implements ToolExecutor {
  constructor(
    private client: IntegrationToolsClient,
    private orgId: string,
    private projectId: string | undefined,
    private context?: IntegrationContext,
  ) {}
  async toToolDefs(names: string[]): Promise<ToolDef[]> {
    const wanted = new Set(names.filter((n) => n.startsWith('integration.')));
    if (wanted.size === 0 || !this.projectId) return [];
    const defs = await this.client.listTools(this.orgId, this.projectId, this.context);
    return defs.filter((d) => wanted.has(d.name));
  }
  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    if (!this.projectId) return { toolCallId: call.id, name: call.name, content: 'no project bound', isError: true };
    try {
      const r = await this.client.callTool(this.orgId, this.projectId, call.name, call.arguments, this.context);
      return { toolCallId: call.id, name: call.name, content: r.content, isError: r.isError };
    } catch (err) {
      return { toolCallId: call.id, name: call.name, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}
