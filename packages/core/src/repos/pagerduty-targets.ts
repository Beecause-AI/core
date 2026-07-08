import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { PagerDutyTarget } from '../store/types.js';

export type PagerDutyTargetPublic = PagerDutyTarget;

export interface AddPagerDutyTargetInput {
  projectId: string; connectionId: string;
  teamId?: string | null; teamName?: string | null;
  serviceId?: string | null; serviceName?: string | null;
  label?: string | null; metadata?: Record<string, unknown>; addedByUserId: string;
}

export async function listPagerDutyTargets(db: Db, projectId: string): Promise<PagerDutyTarget[]> {
  const snaps = await col(db, 'pagerduty_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<PagerDutyTarget>(d))
    .sort((a, b) => `${a.teamId ?? '*'}::${a.serviceId ?? '*'}`.localeCompare(`${b.teamId ?? '*'}::${b.serviceId ?? '*'}`));
}

export async function pagerdutyTargetExists(db: Db, projectId: string, teamId: string | null, serviceId: string | null): Promise<boolean> {
  const snaps = await col(db, 'pagerduty_targets')
    .where('projectId', '==', projectId)
    .where('teamId', '==', teamId ?? null)
    .where('serviceId', '==', serviceId ?? null).limit(1).get();
  return snaps.length > 0;
}

export async function addPagerDutyTarget(db: Db, input: AddPagerDutyTargetInput): Promise<PagerDutyTarget> {
  const ref = col(db, 'pagerduty_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    teamId: input.teamId ?? null, teamName: input.teamName ?? null,
    serviceId: input.serviceId ?? null, serviceName: input.serviceName ?? null,
    label: input.label ?? null, metadata: input.metadata ?? {},
    addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<PagerDutyTarget>(await ref.get());
}

export async function removePagerDutyTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'pagerduty_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

/** Remove all of a project's targets that reference a connection (orphan cleanup on connection delete). */
export async function removePagerDutyTargetsForConnection(db: Db, projectId: string, connectionId: string): Promise<void> {
  const snaps = await col(db, 'pagerduty_targets')
    .where('projectId', '==', projectId).where('connectionId', '==', connectionId).get();
  await Promise.all(snaps.map((d) => col(db, 'pagerduty_targets').doc(d.id).delete()));
}

export function toPublicPagerDutyTarget(row: PagerDutyTarget): PagerDutyTargetPublic {
  return row;
}
