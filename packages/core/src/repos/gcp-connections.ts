import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { GcpConnection } from '../store/types.js';
import type { GcpSignal } from '../gcp/probe.js';

export type GcpConnectionMetadata = { saEmail?: string; defaultGcpProjectId?: string; availableSignals?: GcpSignal[] };
export type GcpConnectionPublic = Omit<GcpConnection, 'secretCiphertext' | 'metadata'> & { metadata: GcpConnectionMetadata };

export interface AddGcpConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'sa_key' | 'wif'; secretCiphertext: string; secretHint?: string | null;
  metadata?: GcpConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicGcpConnection(row: GcpConnection): GcpConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as GcpConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own.
 *  Firestore can't OR across distinct field values, so we run the two scopes as
 *  separate queries and merge/dedupe by id, then sort by name (matches orderBy(name)). */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<GcpConnection[]> {
  const base = col(db, 'gcp_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, GcpConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<GcpConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Org-shared connections only (admin connections page). */
export async function listOrgConnections(db: Db, orgId: string): Promise<GcpConnection[]> {
  const snaps = await col(db, 'gcp_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<GcpConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<GcpConnection | null> {
  const snap = await col(db, 'gcp_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<GcpConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddGcpConnectionInput): Promise<GcpConnection> {
  const ref = col(db, 'gcp_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, secretCiphertext: input.secretCiphertext, secretHint: input.secretHint ?? null,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<GcpConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<GcpConnection, 'name' | 'mode' | 'secretCiphertext' | 'secretHint' | 'metadata' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'gcp_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'gcp_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.delete();
  return true;
}
