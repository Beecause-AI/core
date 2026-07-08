import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { DynatraceConnection } from '../store/types.js';
import type { DynatraceSignal } from '../dynatrace/probe.js';

export type DynatraceConnectionMetadata = { availableSignals?: DynatraceSignal[] };
export type DynatraceConnectionPublic = Omit<DynatraceConnection, 'secretCiphertext' | 'metadata'> & { metadata: DynatraceConnectionMetadata };

export interface AddDynatraceConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'api_token'; environmentUrl: string;
  secretCiphertext: string; secretHint?: string | null;
  metadata?: DynatraceConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicDynatraceConnection(row: DynatraceConnection): DynatraceConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as DynatraceConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own. */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<DynatraceConnection[]> {
  const base = col(db, 'dynatrace_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, DynatraceConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<DynatraceConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrgConnections(db: Db, orgId: string): Promise<DynatraceConnection[]> {
  const snaps = await col(db, 'dynatrace_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<DynatraceConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<DynatraceConnection | null> {
  const snap = await col(db, 'dynatrace_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<DynatraceConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddDynatraceConnectionInput): Promise<DynatraceConnection> {
  const ref = col(db, 'dynatrace_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, environmentUrl: input.environmentUrl,
    secretCiphertext: input.secretCiphertext, secretHint: input.secretHint ?? null,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<DynatraceConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<DynatraceConnection, 'name' | 'environmentUrl' | 'secretCiphertext' | 'secretHint' | 'metadata' | 'enabled' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'dynatrace_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Deletes the connection; also removes orphan dynatrace_targets. */
export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'dynatrace_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  // Remove all orphan targets referencing this connection
  const targets = await col(db, 'dynatrace_targets').where('connectionId', '==', id).get();
  await Promise.all(targets.map((d) => col(db, 'dynatrace_targets').doc(d.id).delete()));
  await ref.delete();
  return true;
}
