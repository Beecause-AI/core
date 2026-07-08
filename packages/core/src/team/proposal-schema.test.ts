import { describe, it, expect } from 'vitest';
import { TeamProposalSchema, normalizeProposal } from './proposal-schema.js';

describe('proposal-schema', () => {
  it('parses a minimal valid proposal', () => {
    const doc = TeamProposalSchema.parse({
      rationale: 'r',
      assistants: [{ key: 'lead', name: 'Lead', model: 'gemini-3.1-pro-preview' }],
    });
    expect(doc.assistants[0]!.isLead).toBe(false);
    expect(doc.gaps).toEqual([]);
    // tier / isContactPoint are no longer fields on a proposed assistant
    expect('tier' in doc.assistants[0]!).toBe(false);
    expect('isContactPoint' in doc.assistants[0]!).toBe(false);
  });

  it('normalize clamps unknown models to a catalog id and dedupes a single lead', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [
        { key: 'a', name: 'A', model: 'not-a-real-model', isLead: true, delegatesTo: ['b'] },
        { key: 'b', name: 'B', model: 'gemini-3-flash-preview', isLead: true, delegatesTo: ['a', 'missing'] },
      ],
      gaps: [],
    });
    expect(out.assistants[0]!.model).toBe('gemini-3.1-pro-preview'); // lead fallback (capable)
    expect(out.assistants.filter((a) => a.isLead)).toHaveLength(1);  // only first lead kept
    // 'missing' dropped (no sibling); and a↔b is a 2-cycle whose back-edge (b→a) is
    // removed by the acyclic guarantee — the forward edge a→b is kept.
    expect(out.assistants[1]!.delegatesTo).toEqual([]);
    expect(out.assistants[0]!.delegatesTo).toEqual(['b']);
  });

  it('normalize breaks a delegation cycle so the persisted proposal is acyclic', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [
        { key: 'a', name: 'A', model: 'gemini-3-flash-preview', delegatesTo: ['b'] },
        { key: 'b', name: 'B', model: 'gemini-3-flash-preview', delegatesTo: ['c'] },
        { key: 'c', name: 'C', model: 'gemini-3-flash-preview', delegatesTo: ['a'] },
      ],
      gaps: [],
    });
    // 3-cycle a→b→c→a: closing back-edge (c→a) dropped, forward chain preserved.
    expect(out.assistants.find((x) => x.key === 'a')!.delegatesTo).toEqual(['b']);
    expect(out.assistants.find((x) => x.key === 'b')!.delegatesTo).toEqual(['c']);
    expect(out.assistants.find((x) => x.key === 'c')!.delegatesTo).toEqual([]);
  });

  it('normalize clamps an unknown model on a non-lead assistant to the cheap fallback', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [{ key: 'a', name: 'A', model: 'bogus' }],
      gaps: [],
    });
    expect(out.assistants[0]!.model).toBe('gemini-3-flash-preview');
  });

  it('normalize drops a self-referential delegatesTo key', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [{ key: 'solo', name: 'Solo', model: 'gemini-3-flash-preview', delegatesTo: ['solo'] }],
      gaps: [],
    });
    expect(out.assistants[0]!.delegatesTo).toEqual([]);
  });

  it('injects github read tools + memory.recall on every assistant and strips slack', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [{ key: 'a', name: 'Code', model: 'gemini-3-flash-preview', isLead: true, enabledTools: ['integration.slack.post_message'] }],
      gaps: [],
    });
    const tools = out.assistants[0]!.enabledTools;
    expect(tools).toContain('memory.recall');
    expect(tools).toContain('integration.github.list_repos');
    expect(tools).toContain('integration.github.get_file');
    expect(tools.some((t) => t.startsWith('integration.slack.'))).toBe(false);
  });

  it('keeps an assistant\'s domain tools (gcp) while adding github + memory', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [{ key: 'g', name: 'GCP', model: 'gemini-3-flash-preview', enabledTools: ['integration.gcp.query_logs'] }],
      gaps: [],
    });
    const tools = out.assistants[0]!.enabledTools;
    expect(tools).toContain('integration.gcp.query_logs');
    expect(tools).toContain('integration.github.search_code');
    expect(tools).toContain('memory.recall');
  });

  it('does not duplicate tools already present', () => {
    const out = normalizeProposal({
      rationale: '',
      assistants: [{ key: 'a', name: 'A', model: 'gemini-3-flash-preview', enabledTools: ['memory.recall', 'integration.github.list_repos'] }],
      gaps: [],
    });
    const tools = out.assistants[0]!.enabledTools;
    expect(tools.filter((t) => t === 'memory.recall')).toHaveLength(1);
    expect(tools.filter((t) => t === 'integration.github.list_repos')).toHaveLength(1);
  });
});
