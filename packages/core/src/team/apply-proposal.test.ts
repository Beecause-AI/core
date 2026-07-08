import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from '../../test/store/emulator.js';
import { createOrgWithOwner, createProject, createAssistant, listAssistants, createTeamProposal } from '../index.js';
import { applyTeamProposal } from './apply-proposal.js';
import type { TeamProposalDoc } from './proposal-schema.js';

const t = testStore('apply-proposal');
let orgId: string;
let projectId: string;

/** Create a generating proposal row so source_proposal_id (a real FK) can be stamped. */
async function mkProposal(org: string, project: string): Promise<string> {
  const p = await createTeamProposal(t.db, { orgId: org, projectId: project, status: 'generating' });
  return p.id;
}

beforeAll(async () => {
  const org = await createOrgWithOwner(t.db, { name: 'ApplyOrg', slug: 'apply-org', userId: 'u-apply-1' });
  orgId = org.id;
  const proj = await createProject(t.db, org.id, { name: 'ApplyProj', slug: 'apply-proj' });
  projectId = proj.id;
});
afterAll(() => t.close());

describe('applyTeamProposal', () => {
  it('creates 2 assistants; lead keeps its non-agent tool and gains agent.<spec.id>; flags persist', async () => {
    const proposal: TeamProposalDoc = {
      rationale: 'r',
      assistants: [
        {
          key: 'lead',
          name: 'Lead',
          persona: '',
          model: 'gemini-3.1-pro-preview',
          provider: 'platform',
          isLead: true,
          enabledTools: ['integration.github.x'],
          delegatesTo: ['spec'],
          rationale: '',
        },
        {
          key: 'spec',
          name: 'Spec',
          persona: '',
          model: 'gemini-3-flash-preview',
          provider: 'platform',
          isLead: false,
          enabledTools: [],
          delegatesTo: [],
          rationale: '',
        },
      ],
      gaps: [],
    };

    const created = await applyTeamProposal(t.db, projectId, proposal, await mkProposal(orgId, projectId));

    expect(created).toHaveLength(2);

    const lead = created.find((a) => a.name === 'Lead')!;
    const spec = created.find((a) => a.name === 'Spec')!;

    expect(lead).toBeDefined();
    expect(spec).toBeDefined();

    // Lead flag persists (tier/contact-point are no longer assistant fields)
    expect(lead.isLead).toBe(true);
    expect(spec.isLead).toBe(false);

    // Lead keeps its non-agent tool and gains agent.<spec.id>
    expect(lead.enabledTools).toContain('integration.github.x');
    expect(lead.enabledTools).toContain(`agent.${spec.id}`);

    // Spec has no agent tools
    expect(spec.enabledTools).toHaveLength(0);
  });

  it('applied team has exactly one orchestrator and specialists carry code tools', async () => {
    const orgT = await createOrgWithOwner(t.db, { name: 'TeamOrg', slug: 'team-org', userId: 'u-team-1' });
    const projT = await createProject(t.db, orgT.id, { name: 'TeamProj', slug: 'team-proj' });

    const proposal: TeamProposalDoc = {
      rationale: 'r',
      assistants: [
        {
          key: 'orch', name: 'Orchestrator', persona: '', model: 'gemini-3.1-pro-preview', provider: 'platform',
          isLead: true, enabledTools: ['integration.github.get_file', 'memory.recall'], delegatesTo: ['api', 'infra'], rationale: '',
        },
        {
          key: 'api', name: 'API Specialist', persona: '', model: 'gemini-3-flash-preview', provider: 'platform',
          isLead: false, enabledTools: ['integration.github.get_file', 'integration.github.search_code', 'memory.recall'], delegatesTo: [], rationale: '',
        },
        {
          key: 'infra', name: 'GCP Infra', persona: '', model: 'gemini-3-flash-preview', provider: 'platform',
          isLead: false, enabledTools: ['integration.github.get_file', 'integration.gcp.query_metrics', 'memory.recall'], delegatesTo: [], rationale: '',
        },
      ],
      gaps: [],
    };

    const created = await applyTeamProposal(t.db, projT.id, proposal, await mkProposal(orgT.id, projT.id));
    expect(created.filter((a) => a.isLead)).toHaveLength(1);

    const specialists = created.filter((a) => !a.isLead);
    for (const s of specialists) {
      expect(s.enabledTools.some((tool) => tool.startsWith('integration.github.'))).toBe(true);
    }
    // No slack assistant / no slack tool was created.
    for (const a of created) {
      expect(a.enabledTools.some((tool) => tool.startsWith('integration.slack.'))).toBe(false);
    }
  });

  it('silently skips delegatesTo keys that have no matching created assistant (no agent.undefined)', async () => {
    // Use a fresh isolated project to avoid interference
    const org2 = await createOrgWithOwner(t.db, { name: 'ApplyOrg2', slug: 'apply-org-2', userId: 'u-apply-2' });
    const proj2 = await createProject(t.db, org2.id, { name: 'ApplyProj2', slug: 'apply-proj-2' });
    const pid2 = proj2.id;

    const proposal: TeamProposalDoc = {
      rationale: 'r',
      assistants: [
        {
          key: 'solo',
          name: 'Solo',
          persona: '',
          model: 'gemini-3-flash-preview',
          provider: 'platform',
          isLead: true,
          enabledTools: [],
          // 'ghost' key does not exist in assistants — should be skipped defensively
          delegatesTo: ['ghost'],
          rationale: '',
        },
      ],
      gaps: [],
    };

    const created = await applyTeamProposal(t.db, pid2, proposal, await mkProposal(org2.id, pid2));

    expect(created).toHaveLength(1);
    const solo = created[0]!;

    // No agent.undefined or any stray agent.* tools
    const agentTools = solo.enabledTools.filter((t) => t.startsWith('agent.'));
    expect(agentTools).toHaveLength(0);
  });

  it('strips pre-existing agent.* entries from a proposal enabledTools (delegation comes only from delegatesTo)', async () => {
    const org3 = await createOrgWithOwner(t.db, { name: 'ApplyOrg3', slug: 'apply-org-3', userId: 'u-apply-3' });
    const proj3 = await createProject(t.db, org3.id, { name: 'ApplyProj3', slug: 'apply-proj-3' });

    const created = await applyTeamProposal(t.db, proj3.id, {
      rationale: 'r',
      assistants: [{
        key: 'solo', name: 'Solo', persona: '', model: 'gemini-3-flash-preview', provider: 'platform', isLead: true,
        // A stray agent.<key> literal must not survive — keys aren't real ids.
        enabledTools: ['mcp.search', 'agent.lead'], delegatesTo: [], rationale: '',
      }],
      gaps: [],
    }, await mkProposal(org3.id, proj3.id));

    const solo = created[0]!;
    expect(solo.enabledTools).toContain('mcp.search');
    expect(solo.enabledTools.some((tool) => tool.startsWith('agent.'))).toBe(false);
  });

  it('applied team has no agent.<id> delegation cycle (defensive id-graph break)', async () => {
    const orgC = await createOrgWithOwner(t.db, { name: 'CycleOrg', slug: 'cycle-org', userId: 'u-cycle-1' });
    const projC = await createProject(t.db, orgC.id, { name: 'CycleProj', slug: 'cycle-proj' });

    // A proposal whose delegatesTo (by key) forms a 2-cycle a↔b plus orch→{a,b}.
    // (normalizeProposal would de-cycle this in the real pipeline; here we feed it
    //  raw to prove apply-proposal's own defensive break.)
    const proposal: TeamProposalDoc = {
      rationale: 'r',
      assistants: [
        { key: 'orch', name: 'Orch', persona: '', model: 'gemini-3.1-pro-preview', provider: 'platform', isLead: true, enabledTools: [], delegatesTo: ['a', 'b'], rationale: '' },
        { key: 'a', name: 'A', persona: '', model: 'gemini-3-flash-preview', provider: 'platform', isLead: false, enabledTools: [], delegatesTo: ['b'], rationale: '' },
        { key: 'b', name: 'B', persona: '', model: 'gemini-3-flash-preview', provider: 'platform', isLead: false, enabledTools: [], delegatesTo: ['a'], rationale: '' },
      ],
      gaps: [],
    };

    const created = await applyTeamProposal(t.db, projC.id, proposal, await mkProposal(orgC.id, projC.id));
    const byId = new Map(created.map((a) => [a.id, a]));
    const edgesOf = (a: typeof created[number]) =>
      a.enabledTools.filter((tool) => tool.startsWith('agent.') && !tool.startsWith('agent.sys.')).map((tool) => tool.slice('agent.'.length));

    const color = new Map(created.map((a) => [a.id, 'white' as 'white' | 'gray' | 'black']));
    let cycle = false;
    const visit = (id: string) => {
      color.set(id, 'gray');
      for (const t of edgesOf(byId.get(id)!)) {
        if (!byId.has(t)) continue;
        if (color.get(t) === 'gray') { cycle = true; return; }
        if (color.get(t) === 'white') visit(t);
      }
      color.set(id, 'black');
    };
    for (const a of created) if (color.get(a.id) === 'white') visit(a.id);
    expect(cycle).toBe(false);
  });

  it('preserves agent.sys.* tools through Pass 1 while still stripping sibling agent.<key> refs (Adaptation C)', async () => {
    // Adaptation C: agent.sys.hindsight is a system-reserved tool, not a sibling delegation key.
    // It must survive Pass 1 and coexist with a real sibling delegation resolved in Pass 2.
    const org4 = await createOrgWithOwner(t.db, { name: 'ApplyOrg4', slug: 'apply-org-4', userId: 'u-apply-4' });
    const proj4 = await createProject(t.db, org4.id, { name: 'ApplyProj4', slug: 'apply-proj-4' });

    const created = await applyTeamProposal(t.db, proj4.id, {
      rationale: 'r',
      assistants: [
        {
          key: 'lead',
          name: 'Lead',
          persona: '',
          model: 'gemini-3.1-pro-preview',
          provider: 'platform',
          isLead: true,
          // agent.sys.hindsight must be kept; agent.spec (sibling key) must be stripped in Pass 1
          // and re-added as agent.<uuid> in Pass 2 via delegatesTo.
          enabledTools: ['agent.sys.hindsight', 'mcp.x'],
          delegatesTo: ['spec'],
          rationale: '',
        },
        {
          key: 'spec',
          name: 'Spec',
          persona: '',
          model: 'gemini-3-flash-preview',
          provider: 'platform',
          isLead: false,
          enabledTools: [],
          delegatesTo: [],
          rationale: '',
        },
      ],
      gaps: [],
    }, await mkProposal(org4.id, proj4.id));

    expect(created).toHaveLength(2);
    const lead = created.find((a) => a.name === 'Lead')!;
    const spec = created.find((a) => a.name === 'Spec')!;

    // agent.sys.hindsight must be preserved (system tool, not a sibling key)
    expect(lead.enabledTools).toContain('agent.sys.hindsight');
    // non-agent tool preserved too
    expect(lead.enabledTools).toContain('mcp.x');
    // sibling delegation resolved to real uuid
    expect(lead.enabledTools).toContain(`agent.${spec.id}`);
    // no stray agent.spec literal remained
    expect(lead.enabledTools).not.toContain('agent.spec');
  });

  it('stamps source_proposal_id and replaces prior autogen agents but keeps manual ones', async () => {
    const orgR = await createOrgWithOwner(t.db, { name: 'ReplaceOrg', slug: 'replace-org', userId: 'u-replace-1' });
    const projR = await createProject(t.db, orgR.id, { name: 'ReplaceProj', slug: 'replace-proj' });

    const doc: TeamProposalDoc = {
      rationale: 'r',
      assistants: [
        { key: 'lead', name: 'Lead', persona: '', model: 'gemini-3-flash-preview', provider: 'platform', isLead: true, enabledTools: [], delegatesTo: ['spec'], rationale: '' },
        { key: 'spec', name: 'Spec', persona: '', model: 'gemini-3-flash-preview', provider: 'platform', isLead: false, enabledTools: [], delegatesTo: [], rationale: '' },
      ],
      gaps: [],
    };

    // A manually-created agent must survive a redesign.
    const manual = await createAssistant(t.db, projR.id, { name: 'Manual' });

    const p1 = await mkProposal(orgR.id, projR.id);
    const firstCreated = await applyTeamProposal(t.db, projR.id, doc, p1);
    expect(firstCreated.every((a) => a.sourceProposalId === p1)).toBe(true);
    expect(firstCreated.every((a) => a.userModified === false)).toBe(true);

    const p2 = await mkProposal(orgR.id, projR.id);
    await applyTeamProposal(t.db, projR.id, doc, p2);

    const all = await listAssistants(t.db, projR.id);
    expect(all.some((a) => a.id === manual.id)).toBe(true);                  // manual survives
    expect(all.some((a) => a.sourceProposalId === p1)).toBe(false);          // old version wiped
    expect(all.filter((a) => a.sourceProposalId === p2)).toHaveLength(2);    // new version present
  });
});
