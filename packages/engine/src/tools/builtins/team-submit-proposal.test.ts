import { describe, it, expect, vi } from 'vitest';
import { makeTeamSubmitProposal } from './team-submit-proposal.js';

describe('team.submit_proposal builtin', () => {
  it('forwards the proposal object to submit and confirms', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const tool = makeTeamSubmitProposal(submit);
    expect(tool.def.name).toBe('team.submit_proposal');
    expect(tool.def.mutates).toBe(false);
    const out = await tool.run({ proposal: { rationale: 'r', assistants: [], gaps: [] } }, new AbortController().signal);
    expect(submit).toHaveBeenCalledWith({ rationale: 'r', assistants: [], gaps: [] });
    expect(out).toMatch(/accepted/i);
  });
  it('throws when proposal missing', async () => {
    const tool = makeTeamSubmitProposal(vi.fn());
    await expect(tool.run({}, new AbortController().signal)).rejects.toThrow();
  });
});
