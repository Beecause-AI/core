import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { GrafanaConnection, GrafanaSignal, GrafanaDatasourceRef } from '../store/types.js';

export type GrafanaConnectionMetadata = {
  grafanaOrgName?: string;
  availableSignals?: GrafanaSignal[];
  datasources?: GrafanaDatasourceRef[];
};
export type GrafanaConnectionPublic = Omit<GrafanaConnection, 'secretCiphertext' | 'metadata'> & { metadata: GrafanaConnectionMetadata };

export interface AddGrafanaConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'grafana'; baseUrl: string; secretCiphertext: string; secretHint?: string | null;
  metadata?: GrafanaConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicGrafanaConnection(row: GrafanaConnection): GrafanaConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as GrafanaConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own. */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<GrafanaConnection[]> {
  const base = col(db, 'grafana_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, GrafanaConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<GrafanaConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Org-shared connections only (admin connections page). */
export async function listOrgConnections(db: Db, orgId: string): Promise<GrafanaConnection[]> {
  const snaps = await col(db, 'grafana_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<GrafanaConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<GrafanaConnection | null> {
  const snap = await col(db, 'grafana_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<GrafanaConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddGrafanaConnectionInput): Promise<GrafanaConnection> {
  const ref = col(db, 'grafana_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, baseUrl: input.baseUrl, secretCiphertext: input.secretCiphertext,
    secretHint: input.secretHint ?? null, metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<GrafanaConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<GrafanaConnection, 'name' | 'baseUrl' | 'secretCiphertext' | 'secretHint' | 'metadata' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'grafana_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'grafana_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.delete();
  return true;
}
