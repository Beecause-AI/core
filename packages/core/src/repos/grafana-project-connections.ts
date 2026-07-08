import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { GrafanaProjectConnection } from '../store/types.js';

// One binding per project (unique on projectId) → projectId is the doc id.
export async function getProjectConnection(db: Db, projectId: string): Promise<GrafanaProjectConnection | null> {
  const snap = await col(db, 'grafana_project_connections').doc(projectId).get();
  return snap.exists ? fromDoc<GrafanaProjectConnection>(snap) : null;
}

export async function setProjectConnection(db: Db, input: { orgId: string; projectId: string; connectionId: string; userId?: string | null }): Promise<GrafanaProjectConnection> {
  const ref = col(db, 'grafana_project_connections').doc(input.projectId);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update(toDoc({ connectionId: input.connectionId, updatedAt: FieldValue.serverTimestamp() }));
  } else {
    const row = applyDefaults({
      orgId: input.orgId, projectId: input.projectId, connectionId: input.connectionId,
      createdByUserId: input.userId ?? null, updatedAt: new Date(),
    }, ref.id);
    await ref.set(toDoc(row));
  }
  return fromDoc<GrafanaProjectConnection>(await ref.get());
}

export async function deleteProjectConnection(db: Db, projectId: string): Promise<boolean> {
  const ref = col(db, 'grafana_project_connections').doc(projectId);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return snap.exists;
}
