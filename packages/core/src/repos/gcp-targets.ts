import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { GcpTarget } from '../store/types.js';
import type { GcpSignal } from '../gcp/probe.js';

export type GcpTargetMetadata = { availableSignals?: GcpSignal[] };
export type GcpTargetPublic = Omit<GcpTarget, 'metadata'> & { metadata: GcpTargetMetadata };

export interface AddGcpTargetInput {
  projectId: string; connectionId: string; gcpProjectId: string;
  label?: string | null; metadata?: GcpTargetMetadata; addedByUserId: string;
}

export async function listGcpTargets(db: Db, projectId: string): Promise<GcpTarget[]> {
  const snaps = await col(db, 'gcp_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<GcpTarget>(d)).sort((a, b) => a.gcpProjectId.localeCompare(b.gcpProjectId));
}

export async function gcpTargetExists(db: Db, projectId: string, gcpProjectId: string): Promise<boolean> {
  const snaps = await col(db, 'gcp_targets')
    .where('projectId', '==', projectId).where('gcpProjectId', '==', gcpProjectId).limit(1).get();
  return snaps.length > 0;
}

export async function addGcpTarget(db: Db, input: AddGcpTargetInput): Promise<GcpTarget> {
  const ref = col(db, 'gcp_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId, gcpProjectId: input.gcpProjectId,
    label: input.label ?? null, metadata: input.metadata ?? {}, addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<GcpTarget>(await ref.get());
}

export async function removeGcpTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'gcp_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

export async function setGcpTargetSignals(db: Db, targetId: string, signals: GcpSignal[]): Promise<void> {
  const ref = col(db, 'gcp_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const meta = (snap.data()?.metadata as GcpTargetMetadata) ?? {};
  await ref.update(toDoc({ metadata: { ...meta, availableSignals: signals } }));
}

export function toPublicGcpTarget(row: GcpTarget): GcpTargetPublic {
  const meta = (row.metadata as GcpTargetMetadata) ?? {};
  return { ...row, metadata: { availableSignals: meta.availableSignals } };
}
