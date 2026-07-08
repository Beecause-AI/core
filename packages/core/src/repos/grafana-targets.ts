import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { GrafanaTarget } from '../store/types.js';

export type GrafanaTargetMetadata = Record<string, never>;
export type GrafanaTargetPublic = GrafanaTarget;

export interface AddGrafanaTargetInput {
  projectId: string; connectionId: string;
  datasourceUid: string; datasourceType: string;
  name: string; label?: string | null; addedByUserId: string;
}

export async function listGrafanaTargets(db: Db, projectId: string): Promise<GrafanaTarget[]> {
  const snaps = await col(db, 'grafana_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<GrafanaTarget>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the project already has this datasource in its scope (identity = uid). */
export async function grafanaTargetExists(db: Db, projectId: string, datasourceUid: string): Promise<boolean> {
  const snaps = await col(db, 'grafana_targets')
    .where('projectId', '==', projectId)
    .where('datasourceUid', '==', datasourceUid)
    .limit(1)
    .get();
  return snaps.length > 0;
}

export async function addGrafanaTarget(db: Db, input: AddGrafanaTargetInput): Promise<GrafanaTarget> {
  const ref = col(db, 'grafana_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    datasourceUid: input.datasourceUid, datasourceType: input.datasourceType,
    name: input.name, label: input.label ?? null, metadata: {}, addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<GrafanaTarget>(await ref.get());
}

export async function removeGrafanaTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'grafana_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

export function toPublicGrafanaTarget(row: GrafanaTarget): GrafanaTargetPublic {
  return row;
}
