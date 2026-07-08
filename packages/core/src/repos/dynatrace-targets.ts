import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { DynatraceTarget } from '../store/types.js';

export type DynatraceTargetPublic = DynatraceTarget;

export interface AddDynatraceTargetInput {
  projectId: string; connectionId: string; managementZone?: string | null; service?: string | null;
  label?: string | null; metadata?: Record<string, unknown>; addedByUserId: string;
}

export async function listDynatraceTargets(db: Db, projectId: string): Promise<DynatraceTarget[]> {
  const snaps = await col(db, 'dynatrace_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<DynatraceTarget>(d))
    .sort((a, b) => `${a.managementZone ?? '*'}::${a.service ?? '*'}`.localeCompare(`${b.managementZone ?? '*'}::${b.service ?? '*'}`));
}

export async function dynatraceTargetExists(db: Db, projectId: string, managementZone: string | null, service: string | null): Promise<boolean> {
  const snaps = await col(db, 'dynatrace_targets')
    .where('projectId', '==', projectId)
    .where('managementZone', '==', managementZone ?? null)
    .where('service', '==', service ?? null).limit(1).get();
  return snaps.length > 0;
}

export async function addDynatraceTarget(db: Db, input: AddDynatraceTargetInput): Promise<DynatraceTarget> {
  const ref = col(db, 'dynatrace_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    managementZone: input.managementZone ?? null, service: input.service ?? null,
    label: input.label ?? null, metadata: input.metadata ?? {},
    addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<DynatraceTarget>(await ref.get());
}

export async function removeDynatraceTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'dynatrace_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

/** Remove all of a project's targets that reference a connection (orphan cleanup on connection delete). */
export async function removeDynatraceTargetsForConnection(db: Db, projectId: string, connectionId: string): Promise<void> {
  const snaps = await col(db, 'dynatrace_targets')
    .where('projectId', '==', projectId).where('connectionId', '==', connectionId).get();
  await Promise.all(snaps.map((d) => col(db, 'dynatrace_targets').doc(d.id).delete()));
}

export function toPublicDynatraceTarget(row: DynatraceTarget): DynatraceTargetPublic {
  return row;
}
