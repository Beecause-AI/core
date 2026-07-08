import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { PagerDutyConnection } from '../store/types.js';
import type { PagerDutySignal } from '../pagerduty/probe.js';

export type PagerDutyConnectionMetadata = { availableSignals?: PagerDutySignal[] };
export type PagerDutyConnectionPublic = Omit<PagerDutyConnection, 'secretCiphertext' | 'metadata'> & { metadata: PagerDutyConnectionMetadata };

export interface AddPagerDutyConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'api_keys'; region: string;
  secretCiphertext: string; secretHint?: string | null;
  metadata?: PagerDutyConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicPagerDutyConnection(row: PagerDutyConnection): PagerDutyConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as PagerDutyConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own. */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<PagerDutyConnection[]> {
  const base = col(db, 'pagerduty_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, PagerDutyConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<PagerDutyConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrgConnections(db: Db, orgId: string): Promise<PagerDutyConnection[]> {
  const snaps = await col(db, 'pagerduty_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<PagerDutyConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<PagerDutyConnection | null> {
  const snap = await col(db, 'pagerduty_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<PagerDutyConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddPagerDutyConnectionInput): Promise<PagerDutyConnection> {
  const ref = col(db, 'pagerduty_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, region: input.region,
    secretCiphertext: input.secretCiphertext, secretHint: input.secretHint ?? null,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<PagerDutyConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<PagerDutyConnection, 'name' | 'region' | 'secretCiphertext' | 'secretHint' | 'metadata' | 'enabled' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'pagerduty_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Deletes the connection; also removes orphan pagerduty_targets. */
export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'pagerduty_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  // Remove all orphan targets referencing this connection
  const targets = await col(db, 'pagerduty_targets').where('connectionId', '==', id).get();
  await Promise.all(targets.map((d) => col(db, 'pagerduty_targets').doc(d.id).delete()));
  await ref.delete();
  return true;
}
