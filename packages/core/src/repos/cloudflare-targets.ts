import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { CloudflareTarget } from '../store/types.js';
import type { CloudflareSignal } from '../cloudflare/probe.js';

export type CloudflareTargetMetadata = { availableSignals?: CloudflareSignal[] };

export interface AddCloudflareTargetInput {
  projectId: string; connectionId: string; kind: 'account' | 'zone';
  accountId: string; zoneId?: string | null; name: string; label?: string | null;
  workerScripts?: string[] | null; metadata?: CloudflareTargetMetadata; addedByUserId: string;
}

export type CloudflareTargetPublic = Omit<CloudflareTarget, 'metadata'> & { metadata: CloudflareTargetMetadata };

export async function listCloudflareTargets(db: Db, projectId: string): Promise<CloudflareTarget[]> {
  const snaps = await col(db, 'cloudflare_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<CloudflareTarget>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the project already has this exact resource in its scope.
 *  Identity = (kind, accountId, zoneId); account rows have zoneId null. */
export async function cloudflareTargetExists(
  db: Db, projectId: string, kind: 'account' | 'zone', accountId: string, zoneId: string | null,
): Promise<boolean> {
  const snaps = await col(db, 'cloudflare_targets')
    .where('projectId', '==', projectId)
    .where('kind', '==', kind)
    .where('accountId', '==', accountId)
    .where('zoneId', '==', zoneId)
    .limit(1)
    .get();
  return snaps.length > 0;
}

export async function addCloudflareTarget(db: Db, input: AddCloudflareTargetInput): Promise<CloudflareTarget> {
  const ref = col(db, 'cloudflare_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId, kind: input.kind,
    accountId: input.accountId, zoneId: input.zoneId ?? null, name: input.name, label: input.label ?? null,
    workerScripts: input.workerScripts ?? null, metadata: input.metadata ?? {}, addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<CloudflareTarget>(await ref.get());
}

export async function updateCloudflareTarget(
  db: Db, projectId: string, id: string,
  patch: { label?: string | null; workerScripts?: string[] | null },
): Promise<boolean> {
  const ref = col(db, 'cloudflare_targets').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.update(toDoc(patch));
  return true;
}

export async function removeCloudflareTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'cloudflare_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

export async function setCloudflareTargetSignals(db: Db, targetId: string, signals: CloudflareSignal[]): Promise<void> {
  const ref = col(db, 'cloudflare_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const meta = (snap.data()?.metadata as CloudflareTargetMetadata) ?? {};
  await ref.update(toDoc({ metadata: { ...meta, availableSignals: signals } }));
}

export function toPublicCloudflareTarget(row: CloudflareTarget): CloudflareTargetPublic {
  const meta = (row.metadata as CloudflareTargetMetadata) ?? {};
  return { ...row, metadata: { availableSignals: meta.availableSignals } };
}
