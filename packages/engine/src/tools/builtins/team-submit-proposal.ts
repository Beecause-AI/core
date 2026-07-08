import type { BuiltinTool } from '../types.js';

/**
 * Factory for the `team.submit_proposal` builtin. The builtin forwards the raw proposal object to
 * the injected `submit` callback (wired per-turn in the engine-worker, where it validates with
 * normalizeProposal and persists). Keeping persistence in the callback keeps packages/engine free
 * of any core/db dependency.
 */
export function makeTeamSubmitProposal(submit: (proposal: unknown) => Promise<void>): BuiltinTool {
  return {
    def: {
      name: 'team.submit_proposal',
      description: 'Submit the final designed RCA team. Call exactly once, when your analysis is complete.',
      kind: 'builtin',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          proposal: {
            type: 'object',
            description: 'The team: { rationale: string, assistants: [{key,name,persona,model,provider,isLead,enabledTools,delegatesTo,rationale}], gaps: [] }',
          },
        },
        required: ['proposal'],
        additionalProperties: false,
      },
    },
    async run(args) {
      const { proposal } = (args ?? {}) as { proposal?: unknown };
      if (proposal == null || typeof proposal !== 'object') {
        throw new Error('submit_proposal requires a "proposal" object');
      }
      await submit(proposal);
      return 'Proposal accepted and saved.';
    },
  };
}
