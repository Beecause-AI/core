import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { DatadogTarget } from '../store/types.js';

export type DatadogTargetPublic = DatadogTarget;

export interface AddDatadogTargetInput {
  projectId: string; connectionId: string; env: string; service?: string | null;
  label?: string | null; metadata?: Record<string, unknown>; addedByUserId: string;
}

export async function listDatadogTargets(db: Db, projectId: string): Promise<DatadogTarget[]> {
  const snaps = await col(db, 'datadog_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<DatadogTarget>(d))
    .sort((a, b) => `${a.env}::${a.service ?? '*'}`.localeCompare(`${b.env}::${b.service ?? '*'}`));
}

export async function datadogTargetExists(db: Db, projectId: string, env: string, service: string | null): Promise<boolean> {
  const snaps = await col(db, 'datadog_targets')
    .where('projectId', '==', projectId)
    .where('env', '==', env)
    .where('service', '==', service ?? null).limit(1).get();
  return snaps.length > 0;
}

export async function addDatadogTarget(db: Db, input: AddDatadogTargetInput): Promise<DatadogTarget> {
  const ref = col(db, 'datadog_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    env: input.env, service: input.service ?? null,
    label: input.label ?? null, metadata: input.metadata ?? {},
    addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<DatadogTarget>(await ref.get());
}

export async function removeDatadogTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'datadog_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

/** Remove all of a project's targets that reference a connection (orphan cleanup on connection delete). */
export async function removeDatadogTargetsForConnection(db: Db, projectId: string, connectionId: string): Promise<void> {
  const snaps = await col(db, 'datadog_targets')
    .where('projectId', '==', projectId).where('connectionId', '==', connectionId).get();
  await Promise.all(snaps.map((d) => col(db, 'datadog_targets').doc(d.id).delete()));
}

export function toPublicDatadogTarget(row: DatadogTarget): DatadogTargetPublic {
  return row;
}
