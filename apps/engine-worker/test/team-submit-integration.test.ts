/**
 * Regression test for the prod "unknown tool: team.submit_proposal" bug, exercised through the REAL
 * bootstrap (buildEngineDeps) toolsFor/toolNamesFor + the real submit builtin + normalizeProposal +
 * saveTeamProposalResult against the Firestore emulator.
 *
 * The orchestrator always submits on a RESUMED turn; bootstrap gates team.submit_proposal on
 * payload.proposalId. Task 1.1 guarantees the resume carries proposalId; this asserts that with it,
 * the tool actually executes and persists the team — and that without it the tool is neither
 * advertised nor executable (the historical failure, now an explicit guard).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, createProject, createTeamProposal, getTeamProposal, type QueuedTurn } from '@intellilabs/core';
import { inMemoryDispatcher } from '@intellilabs/engine';
import { buildEngineDeps, type EngineRuntime } from '../src/engine/bootstrap.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let db: any;
let orgId: string;
let projectId: string;
let deps: EngineRuntime;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Submit Org', slug: 'submit-org', userId: 'u1' });
  orgId = org.id;
  const project = await createProject(db, orgId, { name: 'SubmitProject', slug: 'submit-project' });
  projectId = project.id;
  deps = buildEngineDeps({ store: tdb.store, geminiApiKey: 'k', dispatcher: inMemoryDispatcher(), models: [] });
});

afterAll(async () => { await tdb.stop(); });

const VALID_PROPOSAL = {
  rationale: 'small repo',
  assistants: [
    { key: 'lead', name: 'Orchestrator', model: 'gemini-3.1-pro-preview', isLead: true, enabledTools: ['integration.github.list_repos', 'memory.recall'], delegatesTo: ['code'] },
    { key: 'code', name: 'Code Analyst', model: 'gemini-3-flash-preview', isLead: false, enabledTools: ['integration.github.list_repos', 'memory.recall'], delegatesTo: [] },
  ],
  gaps: [],
};

describe('team.submit_proposal through the real bootstrap', () => {
  it('with proposalId: the tool is advertised, executes, and persists the team (no "unknown tool")', async () => {
    const proposal = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    const turn = { orgId, payload: { proposalId: proposal.id, projectId, enabledTools: ['team.submit_proposal'] } } as unknown as QueuedTurn;

    expect(deps.agentLoop!.toolNamesFor!(turn)).toContain('team.submit_proposal');

    const executor = deps.agentLoop!.toolsFor!(turn);
    const res = await executor.execute(
      { id: 'c-submit', name: 'team.submit_proposal', arguments: { proposal: VALID_PROPOSAL } },
      new AbortController().signal,
    );

    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/accepted/i);

    const saved = await getTeamProposal(db, proposal.id);
    expect(saved!.status).toBe('ready');
    expect(saved!.proposal!.assistants.map((a) => a.name)).toContain('Orchestrator');
  });

  it('without proposalId: the tool is neither advertised nor executable (the prod bug, now guarded)', async () => {
    const turn = { orgId, payload: { projectId, enabledTools: ['team.submit_proposal'] } } as unknown as QueuedTurn;

    expect(deps.agentLoop!.toolNamesFor!(turn)).not.toContain('team.submit_proposal');

    const executor = deps.agentLoop!.toolsFor!(turn);
    const res = await executor.execute(
      { id: 'c-submit', name: 'team.submit_proposal', arguments: { proposal: {} } },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/unknown tool/i);
  });
});
