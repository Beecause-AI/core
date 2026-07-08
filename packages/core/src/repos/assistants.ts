import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { Assistant } from '../store/types.js';

export type AssistantInput = {
  name: string;
  persona?: string;
  model?: string;
  provider?: string | null;
  enabledTools?: string[];
  isLead?: boolean;
  sourceProposalId?: string | null;
  userModified?: boolean;
};

/** Drizzle column defaults for assistants (mirrors schema.ts notNull().default(...)). */
function withAssistantDefaults(input: AssistantInput, projectId: string) {
  return {
    projectId,
    name: input.name,
    persona: input.persona ?? '',
    model: input.model ?? 'gemini-3-flash-preview',
    provider: input.provider ?? null,
    enabledTools: input.enabledTools ?? [],
    isLead: input.isLead ?? false,
    sourceProposalId: input.sourceProposalId ?? null,
    userModified: input.userModified ?? false,
    graphX: null as number | null,
    graphY: null as number | null,
  };
}

export async function createAssistant(db: Db, projectId: string, input: AssistantInput): Promise<Assistant> {
  const ref = col(db, 'assistants').doc();
  const now = new Date();
  const row = applyDefaults(
    { ...withAssistantDefaults(input, projectId), updatedAt: now },
    ref.id,
  );
  await ref.set(toDoc(row));
  return fromDoc<Assistant>(await ref.get());
}
export async function listAssistants(db: Db, projectId: string): Promise<Assistant[]> {
  const snaps = await col(db, 'assistants').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<Assistant>(d));
}
export async function getAssistant(db: Db, projectId: string, id: string): Promise<Assistant | null> {
  const snap = await col(db, 'assistants').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<Assistant>(snap);
  return row.projectId === projectId ? row : null;
}
export async function updateAssistant(db: Db, projectId: string, id: string, patch: Partial<AssistantInput>): Promise<Assistant | null> {
  const ref = col(db, 'assistants').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return null;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return fromDoc<Assistant>(await ref.get());
}
/** The project's single orchestrator: the first `is_lead` assistant (by createdAt), or null. */
export async function getProjectOrchestrator(db: Db, projectId: string): Promise<Assistant | null> {
  const snaps = await col(db, 'assistants')
    .where('projectId', '==', projectId)
    .where('isLead', '==', true)
    .orderBy('createdAt', 'asc')
    .limit(1)
    .get();
  return snaps[0] ? fromDoc<Assistant>(snaps[0]) : null;
}
export async function deleteAssistant(db: Db, projectId: string, id: string): Promise<boolean> {
  const ref = col(db, 'assistants').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

/** Delete every autogen-created agent (source_proposal_id IS NOT NULL) for a project.
 *  Manual agents (source_proposal_id null) are left untouched. Returns the deleted count. */
export async function deleteAutogenAssistants(db: Db, projectId: string): Promise<number> {
  const snaps = await col(db, 'assistants').where('projectId', '==', projectId).get();
  const toDelete = snaps.filter((d) => (d.data()?.sourceProposalId as string | null) != null);
  await Promise.all(toDelete.map((d) => col(db, 'assistants').doc(d.id).delete()));
  return toDelete.length;
}

/** Flag an autogen agent as user-edited (powers the "edited" badge / modified detection). */
export async function markAssistantUserModified(db: Db, projectId: string, id: string): Promise<void> {
  const ref = col(db, 'assistants').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return;
  await ref.update(toDoc({ userModified: true, updatedAt: FieldValue.serverTimestamp() }));
}
