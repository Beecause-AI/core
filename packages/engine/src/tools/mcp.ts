import type { ToolCall, ToolDef, ToolResult } from '../provider.js';
import type { ToolExecutor } from './types.js';

/** Engine-side client to the MCP gateway (HTTP impl injected by the worker). */
export interface GatewayClient {
  listTools(orgId: string, serverNames: string[]): Promise<ToolDef[]>;
  callTool(orgId: string, name: string, args: unknown): Promise<{ content: string; isError?: boolean }>;
}

/** ToolExecutor for mcp.* tools, backed by the gateway. orgId bound per turn. */
export class McpToolExecutor implements ToolExecutor {
  constructor(private gw: GatewayClient, private orgId: string) {}
  async toToolDefs(names: string[]): Promise<ToolDef[]> {
    const mcpNames = names.filter((n) => n.startsWith('mcp.'));
    if (mcpNames.length === 0) return [];
    const serverNames = [...new Set(mcpNames.map((n) => n.split('.')[1]).filter((s): s is string => !!s))];
    const defs = await this.gw.listTools(this.orgId, serverNames);
    const wanted = new Set(mcpNames);
    return defs.filter((d) => wanted.has(d.name));
  }
  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    try {
      const r = await this.gw.callTool(this.orgId, call.name, call.arguments);
      return { toolCallId: call.id, name: call.name, content: r.content, isError: r.isError };
    } catch (err) {
      return { toolCallId: call.id, name: call.name, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}

/** Routes builtin.* to the builtin executor, mcp.* to the MCP executor, agent.* to the optional
 *  agent executor, integration.* to the optional integrations executor, memory.* to the
 *  optional memory executor, recent.* to the optional recent executor, skill.* to the optional
 *  skill executor, and conversations.* to the optional conversations executor. */
export class CompositeToolExecutor implements ToolExecutor {
  constructor(private builtins: ToolExecutor, private mcp: ToolExecutor, private agents?: ToolExecutor, private integrations?: ToolExecutor, private memory?: ToolExecutor, private recent?: ToolExecutor, private skill?: ToolExecutor, private conversations?: ToolExecutor) {}
  async toToolDefs(names: string[]): Promise<ToolDef[]> {
    // builtins own both the builtin.* namespace and team.* (e.g. team.submit_proposal lives in the
    // builtins ToolRegistry but does not use the builtin. prefix).
    const b = await this.builtins.toToolDefs(names.filter((n) => n.startsWith('builtin.') || n.startsWith('team.')));
    const m = await this.mcp.toToolDefs(names.filter((n) => n.startsWith('mcp.')));
    const a = this.agents ? await this.agents.toToolDefs(names.filter((n) => n.startsWith('agent.'))) : [];
    const i = this.integrations ? await this.integrations.toToolDefs(names.filter((n) => n.startsWith('integration.'))) : [];
    const mem = this.memory ? await this.memory.toToolDefs(names.filter((n) => n.startsWith('memory.'))) : [];
    const rec = this.recent ? await this.recent.toToolDefs(names.filter((n) => n.startsWith('recent.'))) : [];
    const sk = this.skill ? await this.skill.toToolDefs(names.filter((n) => n.startsWith('skill.'))) : [];
    const conv = this.conversations ? await this.conversations.toToolDefs(names.filter((n) => n.startsWith('conversations.'))) : [];
    return [...b, ...m, ...a, ...i, ...mem, ...rec, ...sk, ...conv];
  }
  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (call.name.startsWith('builtin.') || call.name.startsWith('team.')) return this.builtins.execute(call, signal);
    if (call.name.startsWith('mcp.')) return this.mcp.execute(call, signal);
    if (call.name.startsWith('agent.')) return this.agents ? this.agents.execute(call, signal) : { toolCallId: call.id, name: call.name, content: 'no agent source', isError: true };
    if (call.name.startsWith('integration.')) return this.integrations ? this.integrations.execute(call, signal) : { toolCallId: call.id, name: call.name, content: 'no integration source', isError: true };
    if (call.name.startsWith('memory.')) return this.memory ? this.memory.execute(call, signal) : { toolCallId: call.id, name: call.name, content: 'no memory source', isError: true };
    if (call.name.startsWith('recent.')) return this.recent ? this.recent.execute(call, signal) : { toolCallId: call.id, name: call.name, content: 'no recent source', isError: true };
    if (call.name.startsWith('skill.')) return this.skill ? this.skill.execute(call, signal) : { toolCallId: call.id, name: call.name, content: 'no skill source', isError: true };
    if (call.name.startsWith('conversations.')) return this.conversations ? this.conversations.execute(call, signal) : { toolCallId: call.id, name: call.name, content: 'no conversations source', isError: true };
    return { toolCallId: call.id, name: call.name, content: `unknown tool: ${call.name}`, isError: true };
  }
}
