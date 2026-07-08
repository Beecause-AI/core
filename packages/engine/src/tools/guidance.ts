/** Usage guidance for the flat engine tools, injected into the prompt of any agent that holds the
 *  tool. One source of truth for both run paths (server `appendIntegrationSkills`, engine
 *  `subagent.ts`). Context-rich integration.* tools render their own guidance with DB lookups and
 *  are NOT covered here. */

export const RECENT_SEARCH_GUIDANCE =
  "Search this project's past incidents before digging in: call `recent.search` with a short " +
  'description of the current problem (component, error signature, symptom) to find related past ' +
  'incidents, then `conversations.read` an id to inspect one. Treat matches as leads, not proof.';

export const MEMORY_RECALL_GUIDANCE =
  "You have memory from past incidents — your own and your team's. Call `memory.recall` with a " +
  'short description of what you are investigating BEFORE digging in, and again whenever you hit a ' +
  'new sub-problem. Treat recalled notes as hints, not gospel.';

export type ToolGuidance = {
  tool: string;
  /** `always`: emit on every turn the tool is held. `incidentStart`: only at the first turn of a
   *  new incident (the lead's "search first" nudge — avoids re-nudging Slack follow-ups). */
  cadence: 'always' | 'incidentStart';
  text: string;
};

export const TOOL_GUIDANCE: ToolGuidance[] = [
  { tool: 'recent.search', cadence: 'incidentStart', text: RECENT_SEARCH_GUIDANCE },
  { tool: 'memory.recall', cadence: 'always', text: MEMORY_RECALL_GUIDANCE },
];

/** System-message bodies for every held flat tool, filtered by cadence. An `incidentStart` tool is
 *  emitted iff `opts.incidentStart === true`. */
export function toolGuidanceBlocks(
  enabledTools: string[],
  opts: { incidentStart: boolean },
): string[] {
  return TOOL_GUIDANCE.filter((g) => enabledTools.includes(g.tool))
    .filter((g) => g.cadence === 'always' || opts.incidentStart)
    .map((g) => g.text);
}
