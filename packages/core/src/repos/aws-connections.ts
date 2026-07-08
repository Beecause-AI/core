import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { AwsConnection } from '../store/types.js';
import type { AwsSignal } from '../aws/probe.js';

export type AwsConnectionMetadata = { availableSignals?: AwsSignal[] };
export type AwsConnectionPublic = Omit<AwsConnection, 'secretCiphertext' | 'metadata'> & { metadata: AwsConnectionMetadata };

export interface AddAwsConnectionInput {
  orgId: string; projectId?: string | null; name: string;
  mode: 'access_key' | 'assume_role';
  awsAccountId?: string | null; defaultRegion: string;
  roleArn?: string | null; externalId?: string | null;
  secretCiphertext: string; secretHint?: string | null;
  metadata?: AwsConnectionMetadata; createdByUserId?: string | null;
}

export function toPublicAwsConnection(row: AwsConnection): AwsConnectionPublic {
  const { secretCiphertext, ...rest } = row;
  return { ...rest, metadata: (rest.metadata as AwsConnectionMetadata) ?? {} };
}

/** Connections usable by a project: org-shared (projectId null) + that project's own. */
export async function listConnectionsForProject(db: Db, orgId: string, projectId: string): Promise<AwsConnection[]> {
  const base = col(db, 'aws_connections').where('orgId', '==', orgId);
  const [shared, own] = await Promise.all([
    base.where('projectId', '==', null).get(),
    base.where('projectId', '==', projectId).get(),
  ]);
  const byId = new Map<string, AwsConnection>();
  for (const d of [...shared, ...own]) byId.set(d.id, fromDoc<AwsConnection>(d));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrgConnections(db: Db, orgId: string): Promise<AwsConnection[]> {
  const snaps = await col(db, 'aws_connections')
    .where('orgId', '==', orgId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<AwsConnection>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(db: Db, orgId: string, id: string): Promise<AwsConnection | null> {
  const snap = await col(db, 'aws_connections').doc(id).get();
  if (!snap.exists) return null;
  const row = fromDoc<AwsConnection>(snap);
  return row.orgId === orgId ? row : null;
}

export async function addConnection(db: Db, input: AddAwsConnectionInput): Promise<AwsConnection> {
  const ref = col(db, 'aws_connections').doc();
  const now = new Date();
  const row = applyDefaults({
    orgId: input.orgId, projectId: input.projectId ?? null, name: input.name,
    mode: input.mode, awsAccountId: input.awsAccountId ?? null, defaultRegion: input.defaultRegion,
    roleArn: input.roleArn ?? null, externalId: input.externalId ?? null,
    secretCiphertext: input.secretCiphertext, secretHint: input.secretHint ?? null,
    metadata: input.metadata ?? {}, createdByUserId: input.createdByUserId ?? null,
    enabled: true, lastTestedAt: null, lastTestOk: null, updatedAt: now,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<AwsConnection>(await ref.get());
}

export async function updateConnection(
  db: Db, orgId: string, id: string,
  patch: Partial<Pick<AwsConnection, 'name' | 'mode' | 'awsAccountId' | 'defaultRegion' | 'roleArn' | 'externalId' | 'secretCiphertext' | 'secretHint' | 'metadata' | 'lastTestedAt' | 'lastTestOk'>>,
): Promise<boolean> {
  const ref = col(db, 'aws_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.update(toDoc({ ...patch, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

export async function deleteConnection(db: Db, orgId: string, id: string): Promise<boolean> {
  const ref = col(db, 'aws_connections').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.orgId as string) !== orgId) return false;
  await ref.delete();
  return true;
}
