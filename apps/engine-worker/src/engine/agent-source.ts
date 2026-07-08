import { listAssistants, getOrgById, listSystemAgents, listAnalysisAgents, type Db } from '@intellilabs/core';
import { AgentToolExecutor, type ToolCall, type ToolExecutor, type ToolResult } from '@intellilabs/engine';

/** Per-turn ToolExecutor exposing sibling assistants in the project as agent.<id> tools.
 *  Excludes the orchestrator itself (selfAssistantId). Lists lazily in toToolDefs (async).
 *  When the org has hindsightEnabled, also exposes system-agent cards (e.g. agent.sys.slack). */
export function makeAgentSource(db: Db, orgId: string, projectId: string | undefined, selfAssistantId: string | undefined): ToolExecutor {
  return {
    async toToolDefs(names: string[]) {
      if (!projectId) return [];
      const assistants = await listAssistants(db, projectId);
      const cards = assistants
        .filter((a) => a.id !== selfAssistantId)
        .map((a) => ({ id: a.id, name: a.name, description: a.persona ?? a.name }));
      const org = await getOrgById(db, orgId);
      if (org?.hindsightEnabled) {
        for (const s of listSystemAgents()) cards.push({ id: `sys.${s.key}`, name: `${s.name} (system)`, description: s.persona });
      }
      // Analysis-fleet agents are always in the card pool; toToolDefs filters by requested names,
      // so they're only offered to an agent (e.g. the analysis orchestrator) that names them.
      for (const a of listAnalysisAgents()) cards.push({ id: `sys.${a.key}`, name: `${a.name} (analysis)`, description: a.persona });
      return new AgentToolExecutor(cards).toToolDefs(names);
    },
    async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
      return { toolCallId: call.id, name: call.name, content: 'agent tool must be invoked via sub-agent suspend', isError: true };
    },
  };
}
