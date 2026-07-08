import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { TeamProposal } from '../store/types.js';
import type { TeamProposalDoc } from '../team/proposal-schema.js';

const ACTIVE = ['awaiting_kg', 'generating', 'ready'] as const;

export async function createTeamProposal(
  db: Db, input: { orgId: string; projectId: string; status: 'awaiting_kg' | 'generating' },
): Promise<TeamProposal> {
  const ref = col(db, 'team_proposals').doc();
  const row = applyDefaults({ orgId: input.orgId, projectId: input.projectId, status: input.status }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<TeamProposal>(await ref.get());
}

/** The newest proposal that is still actionable (awaiting_kg | generating | ready), or null. */
export async function getActiveTeamProposal(db: Db, projectId: string): Promise<TeamProposal | null> {
  const snaps = await col(db, 'team_proposals')
    .where('projectId', '==', projectId)
    .where('status', 'in', [...ACTIVE])
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return snaps[0] ? fromDoc<TeamProposal>(snaps[0]) : null;
}

/**
 * The newest proposal that is NOT discarded (generating | ready | applied | failed | awaiting_kg),
 * or null. Unlike getActiveTeamProposal this still returns an applied proposal — it powers the
 * "last generation" results page, which must survive after the team has been applied.
 */
export async function getLatestTeamProposal(db: Db, projectId: string): Promise<TeamProposal | null> {
  // Firestore can't combine `status != 'discarded'` with an ordered-by-createdAt query cheaply,
  // so fetch the project's proposals newest-first and pick the first non-discarded one.
  const snaps = await col(db, 'team_proposals')
    .where('projectId', '==', projectId)
    .orderBy('createdAt', 'desc')
    .get();
  const row = snaps.find((d) => (d.data()?.status as string) !== 'discarded');
  return row ? fromDoc<TeamProposal>(row) : null;
}

export async function getTeamProposal(db: Db, id: string): Promise<TeamProposal | null> {
  const snap = await col(db, 'team_proposals').doc(id).get();
  return snap.exists ? fromDoc<TeamProposal>(snap) : null;
}

export async function setTeamProposalStatus(
  db: Db, id: string, status: string, fields: { buildId?: string | null; error?: string | null } = {},
): Promise<void> {
  await col(db, 'team_proposals').doc(id).update(toDoc({
    status,
    ...(fields.buildId !== undefined ? { buildId: fields.buildId } : {}),
    ...(fields.error !== undefined ? { error: fields.error } : {}),
  }));
}

/** Update the live pipeline phase shown in the generation progress UI (no-op fields otherwise). */
export async function setTeamProposalProgress(db: Db, id: string, phase: string): Promise<void> {
  await col(db, 'team_proposals').doc(id).update(toDoc({ progress: phase }));
}

export async function saveTeamProposalResult(
  db: Db, id: string, result: { proposal: TeamProposalDoc; buildId: string | null; facts?: unknown },
): Promise<void> {
  const ref = col(db, 'team_proposals').doc(id);
  const snap = await ref.get();
  const projectId = snap.data()?.projectId as string;
  // Next per-project version number. The current row's version is still null here, so it is
  // excluded from the max(). One generation runs at a time, so no real race.
  const siblings = await col(db, 'team_proposals').where('projectId', '==', projectId).get();
  const maxVersion = siblings.reduce((m, d) => {
    const v = d.data()?.version as number | null;
    return v != null && v > m ? v : m;
  }, 0);
  await ref.update(toDoc({
    status: 'ready', proposal: result.proposal, buildId: result.buildId,
    // Only overwrite facts when provided. The agentic path persists facts at enqueue
    // (setTeamProposalFacts) and its submit tool passes none — don't clobber them with null.
    ...(result.facts !== undefined ? { facts: result.facts as never } : {}),
    error: null, progress: null,
    version: maxVersion + 1,
  }));
}

/** Persist the deterministic Facts at enqueue time (agentic path), so the proposal can report
 *  detected gaps before the orchestrator submits. saveTeamProposalResult preserves these. */
export async function setTeamProposalFacts(db: Db, id: string, facts: unknown): Promise<void> {
  await col(db, 'team_proposals').doc(id).update(toDoc({ facts: facts as never }));
}

export async function markTeamProposalApplied(db: Db, id: string): Promise<void> {
  await col(db, 'team_proposals').doc(id).update(toDoc({ status: 'applied', appliedAt: FieldValue.serverTimestamp() }));
}

export type TeamVersion = {
  id: string; version: number | null; createdAt: Date; status: string;
  isActive: boolean; agentCount: number; rationale: string;
};

/** The 10 most recent usable (ready|applied) versions newest-first, plus the total count. */
export async function listTeamVersions(
  db: Db, projectId: string,
): Promise<{ versions: TeamVersion[]; total: number }> {
  const activeId = await getProjectActiveProposalId(db, projectId);
  const snaps = await col(db, 'team_proposals')
    .where('projectId', '==', projectId)
    .where('status', 'in', ['ready', 'applied'])
    .orderBy('createdAt', 'desc')
    .get();
  const rows = snaps.map((d) => fromDoc<TeamProposal>(d));
  const versions = rows.slice(0, 10).map((r) => ({
    id: r.id, version: r.version, createdAt: r.createdAt, status: r.status,
    isActive: r.id === activeId,
    agentCount: r.proposal?.assistants.length ?? 0,
    rationale: r.proposal?.rationale ?? '',
  }));
  return { versions, total: rows.length };
}

export async function getProjectActiveProposalId(db: Db, projectId: string): Promise<string | null> {
  const snap = await col(db, 'projects').doc(projectId).get();
  return snap.exists ? ((snap.data()?.activeProposalId as string | null) ?? null) : null;
}

export async function setProjectActiveProposal(db: Db, projectId: string, proposalId: string): Promise<void> {
  await col(db, 'projects').doc(projectId).update(toDoc({ activeProposalId: proposalId }));
}
