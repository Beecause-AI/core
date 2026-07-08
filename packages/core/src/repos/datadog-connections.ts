import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { DatadogConnection } from '../store/types.js';
import type { DatadogSignal } from '../datadog/probe.js';

export type DatadogConnectionMetadata = { availableSignals?: DatadogSignal[] };
export type DatadogConnectionPublic = Omit<DatadogConnection, 'secretCiphertext' | 'metadata'> & { metadata: DatadogConnectionMetadata };

export interface AddDatadogConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'api_keys'; site: string;
  secretCiphertext: string; secretHint?: string | null;
  metadata?: DatadogConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicDatadogConnection(row: DatadogConnection): DatadogConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as DatadogConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own. */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<DatadogConnection[]> {
  const base = col(db, 'datadog_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, DatadogConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<DatadogConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrgConnections(db: Db, orgId: string): Promise<DatadogConnection[]> {
  const snaps = await col(db, 'datadog_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<DatadogConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<DatadogConnection | null> {
  const snap = await col(db, 'datadog_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<DatadogConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddDatadogConnectionInput): Promise<DatadogConnection> {
  const ref = col(db, 'datadog_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, site: input.site,
    secretCiphertext: input.secretCiphertext, secretHint: input.secretHint ?? null,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<DatadogConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<DatadogConnection, 'name' | 'site' | 'secretCiphertext' | 'secretHint' | 'metadata' | 'enabled' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'datadog_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Deletes the connection; also removes orphan datadog_targets. */
export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'datadog_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  // Remove all orphan targets referencing this connection
  const targets = await col(db, 'datadog_targets').where('connectionId', '==', id).get();
  await Promise.all(targets.map((d) => col(db, 'datadog_targets').doc(d.id).delete()));
  await ref.delete();
  return true;
}
