import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { CloudflareConnection } from '../store/types.js';
import type { CloudflareSignal } from '../cloudflare/probe.js';

export type CloudflareConnectionMetadata = { accountId?: string; accountName?: string; availableSignals?: CloudflareSignal[] };
export type CloudflareConnectionPublic = Omit<CloudflareConnection, 'secretCiphertext' | 'metadata'> & { metadata: CloudflareConnectionMetadata };

export interface AddCloudflareConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'api_token' | 'global_key'; secretCiphertext: string;
  metadata?: CloudflareConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicCloudflareConnection(row: CloudflareConnection): CloudflareConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as CloudflareConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own.
 *  Firestore can't OR across distinct field values, so we run the two scopes as
 *  separate queries and merge/dedupe by id, then sort by name (matches orderBy(name)). */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<CloudflareConnection[]> {
  const base = col(db, 'cloudflare_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, CloudflareConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<CloudflareConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Org-shared connections only (admin connections page). */
export async function listOrgConnections(db: Db, orgId: string): Promise<CloudflareConnection[]> {
  const snaps = await col(db, 'cloudflare_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<CloudflareConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<CloudflareConnection | null> {
  const snap = await col(db, 'cloudflare_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<CloudflareConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddCloudflareConnectionInput): Promise<CloudflareConnection> {
  const ref = col(db, 'cloudflare_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, secretCiphertext: input.secretCiphertext,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<CloudflareConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<CloudflareConnection, 'name' | 'mode' | 'secretCiphertext' | 'metadata' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'cloudflare_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'cloudflare_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.delete();
  return true;
}
