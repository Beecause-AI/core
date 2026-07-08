import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createTeamProposal,
  getTeamProposal,
  getOperation,
  getIntegration,
  saveTeamProposalResult,
  recordModelInvocation,
  upsertIntegration,
  addProjectRepo,
  encryptSecret,
} from '@intellilabs/core';
import { runTeamAutogen } from '../src/team-autogen.js';
import { startTestDb, selectInvocationsBySourcePrefix, selectOperationsByRefId } from './helpers.js';
import type { RepoClient } from '../src/repo-reader.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

// Fake RepoClient: two files — package.json (depends on @google-cloud/pubsub) + wrangler.toml
const fakeClient: RepoClient = {
  getRefInfo: async () => ({ ref: 'main', sha: 'sha1' }),
  listTree: async () => ({
    truncated: false,
    entries: [
      { path: 'package.json', type: 'blob', sha: 'a' },
      { path: 'apps/edge/wrangler.toml', type: 'blob', sha: 'b' },
    ],
  }),
  getFile: async (_c: unknown, _r: string, path: string) => ({
    text: path.endsWith('package.json')
      ? '{"dependencies":{"@google-cloud/pubsub":"1"}}'
      : 'export default { fetch(){} }',
    sha: 'x',
  }),
};

const fakeConfig = { SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') };

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('runTeamAutogen (v3-only fleet)', () => {
  it('agentic path: the fleet submit tool stores a ready proposal, facts persist, op finishes done with real cost', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'GB-V3', slug: 'gb-v3-org', userId: 'u5' });
    const proj = await createProject(t.db, org.id, { name: 'V3P', slug: 'gb-v3-org-p' });
    await upsertIntegration(t.db, {
      orgId: org.id, provider: 'github', mode: 'pat',
      secretCiphertext: encryptSecret('ghp_test', Buffer.alloc(32, 1)), metadata: {}, connectedByUserId: 'u5',
    });
    const integ = await getIntegration(t.db, org.id, 'github');
    await addProjectRepo(t.db, {
      projectId: proj.id, orgIntegrationId: integ!.id, repoFullName: 'acme/myapp', defaultBranch: 'main', addedByUserId: 'u5',
    });
    const proposal = await createTeamProposal(t.db, { orgId: org.id, projectId: proj.id, status: 'generating' });

    // Fake doorbell emulates the engine-worker: the submit tool stores a ready proposal, and a model
    // invocation on the run conversation gives the op real cost to roll up.
    const publishTurn = async (lane: string, _turn: string) => {
      await recordModelInvocation(t.db, { orgId: org.id, source: 'conversation', model: 'gemini-3.1-pro-preview', provider: 'platform', conversationId: lane, inputTokens: 1000, outputTokens: 200, costUsd: '0.05', status: 'ok' });
      await saveTeamProposalResult(t.db, proposal.id, {
        proposal: {
          rationale: 'agentic',
          assistants: [{ key: 'lead', name: 'Lead', persona: 'p', model: 'gemini-3-flash-preview', provider: 'platform', isLead: true, enabledTools: [], delegatesTo: [], rationale: '' }],
          gaps: [],
        },
        buildId: null,
      });
    };

    await runTeamAutogen(
      { db: t.db, client: fakeClient, config: fakeConfig, publishTurn },
      { orgId: org.id, projectId: proj.id, proposalId: proposal.id },
    );

    const after = await getTeamProposal(t.db, proposal.id);
    expect(after?.status).toBe('ready');
    expect(after?.proposal?.rationale).toBe('agentic');

    // Deterministic facts persisted at enqueue survive the agentic submit (which passes no facts):
    // the fake repo depends on @google-cloud/pubsub, so a signal + (gcp-not-connected) gap exist.
    const facts = after?.facts as { signalMap?: unknown[]; gaps?: unknown[] } | null;
    expect((facts?.signalMap ?? []).length).toBeGreaterThan(0);
    expect(Array.isArray(facts?.gaps)).toBe(true);

    // The operation is linked to the analysis conversation and finished done.
    const ops = await selectOperationsByRefId(t.db, proposal.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.runConversationId).toBeTruthy();   // linked to the analysis conversation
    expect(ops[0]!.parentConversationId).toBeNull();  // stays top-level in the activity feed
    expect(ops[0]!.status).toBe('done');
    // Real fleet COST rolled up from the run conversation's model_invocations (not 0). Token totals
    // are intentionally 0 (omitted to avoid a composite-index requirement on incidentRollup).
    const fullOp = await getOperation(t.db, ops[0]!.id);
    expect(Number(fullOp!.costUsd)).toBeGreaterThan(0);
    expect(fullOp!.inputTokens).toBe(0);
    expect(fullOp!.outputTokens).toBe(0);
  });

  it('no digest fallback: when the fleet cannot run, the proposal is marked failed and one op is reused across redeliveries', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'GB-NoFallback', slug: 'gb-nofb', userId: 'u3' });
    const proj = await createProject(t.db, org.id, { name: 'NFB', slug: 'gb-nofb-p' });
    await upsertIntegration(t.db, {
      orgId: org.id, provider: 'github', mode: 'pat',
      secretCiphertext: encryptSecret('ghp_test', Buffer.alloc(32, 1)), metadata: {}, connectedByUserId: 'u3',
    });
    const integ = await getIntegration(t.db, org.id, 'github');
    await addProjectRepo(t.db, {
      projectId: proj.id, orgIntegrationId: integ!.id, repoFullName: 'acme/myapp', defaultBranch: 'main', addedByUserId: 'u3',
    });
    const proposal = await createTeamProposal(t.db, { orgId: org.id, projectId: proj.id, status: 'generating' });
    const job = { orgId: org.id, projectId: proj.id, proposalId: proposal.id };

    // No publishTurn → the agentic fleet can't run. With no digest fallback, generation fails.
    await expect(runTeamAutogen({ db: t.db, client: fakeClient, config: fakeConfig }, job)).rejects.toThrow();
    // A redelivery of the SAME job reuses the one operation (no duplicate row).
    await expect(runTeamAutogen({ db: t.db, client: fakeClient, config: fakeConfig }, job)).rejects.toThrow();

    const ops = await selectOperationsByRefId(t.db, proposal.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('failed');
    expect(ops[0]!.error).toBeTruthy();

    const after = await getTeamProposal(t.db, proposal.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).not.toBeNull();

    // No digest agents ran — the v2 pipeline is gone (no team-autogen:* invocations).
    const invocations = await selectInvocationsBySourcePrefix(t.db, 'team-autogen:');
    expect(invocations.filter((inv) => inv.orgId === org.id)).toHaveLength(0);
  });

  it('marks proposal failed and rethrows when there is no GitHub integration', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'GB-NoGH', slug: 'gb-no-gh', userId: 'u2' });
    const proj = await createProject(t.db, org.id, { name: 'P-NoGH', slug: 'gb-no-gh-p' });
    const proposal = await createTeamProposal(t.db, { orgId: org.id, projectId: proj.id, status: 'generating' });

    await expect(
      runTeamAutogen(
        { db: t.db, client: fakeClient, config: fakeConfig },
        { orgId: org.id, projectId: proj.id, proposalId: proposal.id },
      ),
    ).rejects.toThrow(/no connected code source/);

    const after = await getTeamProposal(t.db, proposal.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).not.toBeNull();
  });
});
