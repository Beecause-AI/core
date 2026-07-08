import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { GcpProjectConnection } from '../store/types.js';

// One binding per project (unique on projectId) → projectId is the doc id.
export async function getProjectConnection(db: Db, projectId: string): Promise<GcpProjectConnection | null> {
  const snap = await col(db, 'gcp_project_connections').doc(projectId).get();
  return snap.exists ? fromDoc<GcpProjectConnection>(snap) : null;
}

export async function setProjectConnection(db: Db, input: { orgId: string; projectId: string; connectionId: string; userId?: string | null }): Promise<GcpProjectConnection> {
  const ref = col(db, 'gcp_project_connections').doc(input.projectId);
  const snap = await ref.get();
  if (snap.exists) {
    // onConflictDoUpdate(target=projectId): only connectionId + updatedAt change.
    await ref.update(toDoc({ connectionId: input.connectionId, updatedAt: FieldValue.serverTimestamp() }));
  } else {
    const row = applyDefaults({
      orgId: input.orgId, projectId: input.projectId, connectionId: input.connectionId,
      createdByUserId: input.userId ?? null, updatedAt: new Date(),
    }, ref.id);
    await ref.set(toDoc(row));
  }
  return fromDoc<GcpProjectConnection>(await ref.get());
}

export async function deleteProjectConnection(db: Db, projectId: string): Promise<boolean> {
  const ref = col(db, 'gcp_project_connections').doc(projectId);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return snap.exists;
}
