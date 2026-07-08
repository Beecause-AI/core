import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import {
  createTeamProposal, getActiveTeamProposal, getLatestTeamProposal, getTeamProposal,
  setTeamProposalStatus, setTeamProposalProgress, saveTeamProposalResult, markTeamProposalApplied,
  listTeamVersions, getProjectActiveProposalId, setProjectActiveProposal,
} from '../../src/repos/team-proposals.js';
import type { TeamProposalDoc } from '../../src/team/proposal-schema.js';

const store = testStore('team-proposals');
const db = store.db;
const orgId = 'o';
const projectId = 'p';

const docFor = (n: number): TeamProposalDoc =>
  ({ rationale: `r${n}`, assistants: Array.from({ length: n }, (_, i) => ({ key: `a${i}` })) } as unknown as TeamProposalDoc);

async function seedProject() {
  await col(db, 'projects').doc(projectId).set(toDoc(applyDefaults({ orgId, name: 'P', slug: 'p', activeProposalId: null }, projectId)));
}

beforeEach(async () => { await wipe(db); await seedProject(); });
afterAll(() => store.close());

describe('team-proposals repo (Firestore)', () => {
  it('create → get; status defaults to the input status', async () => {
    const tp = await createTeamProposal(db, { orgId, projectId, status: 'awaiting_kg' });
    expect(tp.status).toBe('awaiting_kg');
    expect((await getTeamProposal(db, tp.id))?.id).toBe(tp.id);
  });

  it('getActiveTeamProposal returns the newest actionable proposal', async () => {
    const a = await createTeamProposal(db, { orgId, projectId, status: 'awaiting_kg' });
    await new Promise((r) => setTimeout(r, 10));
    const b = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    expect((await getActiveTeamProposal(db, projectId))?.id).toBe(b.id);
    await setTeamProposalStatus(db, b.id, 'discarded');
    expect((await getActiveTeamProposal(db, projectId))?.id).toBe(a.id);
  });

  it('getLatestTeamProposal skips discarded but keeps applied', async () => {
    const a = await createTeamProposal(db, { orgId, projectId, status: 'awaiting_kg' });
    await markTeamProposalApplied(db, a.id);
    await new Promise((r) => setTimeout(r, 10));
    const b = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    await setTeamProposalStatus(db, b.id, 'discarded');
    expect((await getLatestTeamProposal(db, projectId))?.id).toBe(a.id);
  });

  it('setTeamProposalProgress + status fields update in place', async () => {
    const tp = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    await setTeamProposalProgress(db, tp.id, 'flows');
    await setTeamProposalStatus(db, tp.id, 'failed', { error: 'boom', buildId: 'b1' });
    const row = await getTeamProposal(db, tp.id);
    expect(row?.progress).toBe('flows');
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('boom');
    expect(row?.buildId).toBe('b1');
  });

  it('saveTeamProposalResult assigns per-project incrementing versions', async () => {
    const a = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    await saveTeamProposalResult(db, a.id, { proposal: docFor(2), buildId: 'b1' });
    const b = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    await saveTeamProposalResult(db, b.id, { proposal: docFor(3), buildId: 'b2' });
    expect((await getTeamProposal(db, a.id))?.version).toBe(1);
    expect((await getTeamProposal(db, b.id))?.version).toBe(2);
    expect((await getTeamProposal(db, a.id))?.status).toBe('ready');
  });

  it('listTeamVersions returns ready|applied newest-first with active flag + counts', async () => {
    const a = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    await saveTeamProposalResult(db, a.id, { proposal: docFor(2), buildId: 'b1' });
    await new Promise((r) => setTimeout(r, 10));
    const b = await createTeamProposal(db, { orgId, projectId, status: 'generating' });
    await saveTeamProposalResult(db, b.id, { proposal: docFor(3), buildId: 'b2' });
    await setProjectActiveProposal(db, projectId, b.id);

    const { versions, total } = await listTeamVersions(db, projectId);
    expect(total).toBe(2);
    expect(versions[0]!.id).toBe(b.id);
    expect(versions[0]!.isActive).toBe(true);
    expect(versions[0]!.agentCount).toBe(3);
    expect(versions[0]!.rationale).toBe('r3');
    expect(versions[1]!.isActive).toBe(false);
  });

  it('project active-proposal pointer round-trips', async () => {
    expect(await getProjectActiveProposalId(db, projectId)).toBeNull();
    await setProjectActiveProposal(db, projectId, 'prop-x');
    expect(await getProjectActiveProposalId(db, projectId)).toBe('prop-x');
  });
});
