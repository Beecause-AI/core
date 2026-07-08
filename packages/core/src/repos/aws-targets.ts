import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { AwsTarget } from '../store/types.js';

export type AwsTargetPublic = AwsTarget;

export interface AddAwsTargetInput {
  projectId: string; connectionId: string; awsAccountId: string; awsRegion: string;
  label?: string | null; metadata?: Record<string, unknown>; addedByUserId: string;
}

export async function listAwsTargets(db: Db, projectId: string): Promise<AwsTarget[]> {
  const snaps = await col(db, 'aws_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<AwsTarget>(d))
    .sort((a, b) => `${a.awsAccountId}/${a.awsRegion}`.localeCompare(`${b.awsAccountId}/${b.awsRegion}`));
}

export async function awsTargetExists(db: Db, projectId: string, awsAccountId: string, awsRegion: string): Promise<boolean> {
  const snaps = await col(db, 'aws_targets')
    .where('projectId', '==', projectId)
    .where('awsAccountId', '==', awsAccountId)
    .where('awsRegion', '==', awsRegion).limit(1).get();
  return snaps.length > 0;
}

export async function addAwsTarget(db: Db, input: AddAwsTargetInput): Promise<AwsTarget> {
  const ref = col(db, 'aws_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    awsAccountId: input.awsAccountId, awsRegion: input.awsRegion,
    label: input.label ?? null, metadata: input.metadata ?? {}, addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<AwsTarget>(await ref.get());
}

export async function removeAwsTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'aws_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

export function toPublicAwsTarget(row: AwsTarget): AwsTargetPublic {
  return row;
}
