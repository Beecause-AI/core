import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { AzureTarget } from '../store/types.js';

export type AzureTargetPublic = AzureTarget;

export interface AddAzureTargetInput {
  projectId: string; connectionId: string; subscriptionId: string;
  logAnalyticsWorkspaceId?: string | null; region?: string | null;
  label?: string | null; metadata?: Record<string, unknown>; addedByUserId: string;
}

export async function listAzureTargets(db: Db, projectId: string): Promise<AzureTarget[]> {
  const snaps = await col(db, 'azure_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<AzureTarget>(d))
    .sort((a, b) => `${a.subscriptionId}/${a.logAnalyticsWorkspaceId ?? ''}`.localeCompare(`${b.subscriptionId}/${b.logAnalyticsWorkspaceId ?? ''}`));
}

export async function azureTargetExists(db: Db, projectId: string, subscriptionId: string, workspaceId: string | null): Promise<boolean> {
  const snaps = await col(db, 'azure_targets')
    .where('projectId', '==', projectId)
    .where('subscriptionId', '==', subscriptionId)
    .where('logAnalyticsWorkspaceId', '==', workspaceId ?? null).limit(1).get();
  return snaps.length > 0;
}

export async function addAzureTarget(db: Db, input: AddAzureTargetInput): Promise<AzureTarget> {
  const ref = col(db, 'azure_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    subscriptionId: input.subscriptionId, logAnalyticsWorkspaceId: input.logAnalyticsWorkspaceId ?? null,
    region: input.region ?? null, label: input.label ?? null,
    metadata: input.metadata ?? {}, addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<AzureTarget>(await ref.get());
}

export async function removeAzureTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'azure_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

/** Remove all of a project's targets that reference a connection (orphan cleanup on connection delete). */
export async function removeAzureTargetsForConnection(db: Db, projectId: string, connectionId: string): Promise<void> {
  const snaps = await col(db, 'azure_targets')
    .where('projectId', '==', projectId).where('connectionId', '==', connectionId).get();
  await Promise.all(snaps.map((d) => col(db, 'azure_targets').doc(d.id).delete()));
}

export function toPublicAzureTarget(row: AzureTarget): AzureTargetPublic {
  return row;
}
