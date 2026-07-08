import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import { getAllDocs } from '../store/query.js';
import type { AgentSkill } from '../store/types.js';

/** assistant_skills join row (composite PK (assistantId, skillId) → doc id `${a}_${s}`).
 *  No row type lives in store/types.ts, so it is declared locally. */
interface AssistantSkillRow {
  assistantId: string;
  skillId: string;
}

/** Emulates the Postgres uniqueIndex (projectId, name). Firestore has no unique constraints,
 *  so we pre-check and throw the same 23505 the routes map to 409. Non-atomic (documented). */
async function assertNameFree(db: Db, projectId: string, name: string, exceptId?: string): Promise<void> {
  const snaps = await col(db, 'agent_skills')
    .where('projectId', '==', projectId)
    .where('name', '==', name)
    .get();
  if (snaps.some((d) => d.id !== exceptId)) {
    throw Object.assign(new Error('duplicate skill name'), { code: '23505' });
  }
}

export async function createSkill(
  db: Db,
  input: { orgId: string; projectId: string; name: string; description?: string; body?: string },
): Promise<AgentSkill> {
  await assertNameFree(db, input.projectId, input.name);
  const ref = col(db, 'agent_skills').doc();
  const now = new Date();
  const row = applyDefaults(
    {
      orgId: input.orgId,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? '',
      body: input.body ?? '',
      updatedAt: now,
    },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<AgentSkill>(await ref.get());
}

export async function listSkills(db: Db, projectId: string): Promise<AgentSkill[]> {
  const snaps = await col(db, 'agent_skills').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<AgentSkill>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateSkill(
  db: Db,
  projectId: string,
  id: string,
  patch: { name?: string; description?: string; body?: string },
): Promise<AgentSkill | null> {
  const ref = col(db, 'agent_skills').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return null;
  if (patch.name !== undefined && patch.name !== (snap.data()?.name as string)) {
    await assertNameFree(db, projectId, patch.name, id);
  }
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return fromDoc<AgentSkill>(await ref.get());
}

export async function deleteSkill(db: Db, projectId: string, id: string): Promise<boolean> {
  const ref = col(db, 'agent_skills').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

/** Skills attached to an assistant (id+name+description), for the prompt block + editor.
 *  innerJoin assistant_skills→agent_skills: query the join, getAll the skills, stitch + order by name. */
export async function listAttachedSkills(
  db: Db,
  assistantId: string,
): Promise<{ id: string; name: string; description: string }[]> {
  const joins = await col(db, 'assistant_skills').where('assistantId', '==', assistantId).get();
  const skillIds = joins.map((d) => (d.data()?.skillId as string));
  if (skillIds.length === 0) return [];
  const skills = (await getAllDocs(db, 'agent_skills', skillIds)).map((s) => fromDoc<AgentSkill>(s));
  return skills
    .map((s) => ({ id: s.id, name: s.name, description: s.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Replace an assistant's attached-skill set with exactly `skillIds`. */
export async function setAttachedSkills(db: Db, assistantId: string, skillIds: string[]): Promise<void> {
  // Delete existing join rows for this assistant, then create the new set. A Firestore
  // batch keeps the swap atomic (replaces the delete+insert transaction).
  const existing = await col(db, 'assistant_skills').where('assistantId', '==', assistantId).get();
  const batch = db.batch();
  for (const d of existing) batch.delete(col(db, 'assistant_skills').doc(d.id));
  for (const skillId of skillIds) {
    const row: AssistantSkillRow = { assistantId, skillId };
    batch.set(col(db, 'assistant_skills').doc(`${assistantId}_${skillId}`), toDoc(row));
  }
  await batch.commit();
}

/** The body of a skill by name, but only if it is attached to this assistant (in this project). */
export async function loadSkillBody(
  db: Db,
  projectId: string,
  assistantId: string,
  name: string,
): Promise<string | null> {
  const joins = await col(db, 'assistant_skills').where('assistantId', '==', assistantId).get();
  const skillIds = joins.map((d) => (d.data()?.skillId as string));
  if (skillIds.length === 0) return null;
  const skills = (await getAllDocs(db, 'agent_skills', skillIds)).map((s) => fromDoc<AgentSkill>(s));
  const match = skills.find((s) => s.projectId === projectId && s.name === name);
  return match?.body ?? null;
}
