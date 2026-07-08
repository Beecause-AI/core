import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { AzureConnection } from '../store/types.js';
import type { AzureSignal } from '../azure/probe.js';

export type AzureConnectionMetadata = { availableSignals?: AzureSignal[] };
export type AzureConnectionPublic = Omit<AzureConnection, 'secretCiphertext' | 'metadata'> & { metadata: AzureConnectionMetadata };

export interface AddAzureConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'service_principal' | 'workload_identity';
  tenantId: string; clientId: string;
  secretCiphertext: string; secretHint?: string | null;
  federationSubject?: string | null;
  defaultSubscriptionId: string; defaultWorkspaceId?: string | null;
  metadata?: AzureConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicAzureConnection(row: AzureConnection): AzureConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as AzureConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own. */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<AzureConnection[]> {
  const base = col(db, 'azure_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, AzureConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<AzureConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrgConnections(db: Db, orgId: string): Promise<AzureConnection[]> {
  const snaps = await col(db, 'azure_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<AzureConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<AzureConnection | null> {
  const snap = await col(db, 'azure_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<AzureConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddAzureConnectionInput): Promise<AzureConnection> {
  const ref = col(db, 'azure_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, tenantId: input.tenantId, clientId: input.clientId,
    secretCiphertext: input.secretCiphertext, secretHint: input.secretHint ?? null,
    federationSubject: input.federationSubject ?? null,
    defaultSubscriptionId: input.defaultSubscriptionId, defaultWorkspaceId: input.defaultWorkspaceId ?? null,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<AzureConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<AzureConnection, 'name' | 'mode' | 'tenantId' | 'clientId' | 'secretCiphertext' | 'secretHint' | 'federationSubject' | 'defaultSubscriptionId' | 'defaultWorkspaceId' | 'metadata' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'azure_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Deletes the connection; the caller removes orphan azure_targets first (see route). */
export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'azure_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.delete();
  return true;
}
