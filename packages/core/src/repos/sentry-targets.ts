import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { SentryTarget } from '../store/types.js';

export type SentryTargetMetadata = Record<string, never>;

export interface AddSentryTargetInput {
  projectId: string; connectionId: string;
  sentryProjectSlug: string; sentryProjectId: string;
  name: string; label?: string | null; addedByUserId: string;
}

export type SentryTargetPublic = SentryTarget;

export async function listSentryTargets(db: Db, projectId: string): Promise<SentryTarget[]> {
  const snaps = await col(db, 'sentry_targets').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<SentryTarget>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the project already has this Sentry project in its scope (identity = slug). */
export async function sentryTargetExists(db: Db, projectId: string, sentryProjectSlug: string): Promise<boolean> {
  const snaps = await col(db, 'sentry_targets')
    .where('projectId', '==', projectId)
    .where('sentryProjectSlug', '==', sentryProjectSlug)
    .limit(1)
    .get();
  return snaps.length > 0;
}

export async function addSentryTarget(db: Db, input: AddSentryTargetInput): Promise<SentryTarget> {
  const ref = col(db, 'sentry_targets').doc();
  const row = applyDefaults({
    projectId: input.projectId, connectionId: input.connectionId,
    sentryProjectSlug: input.sentryProjectSlug, sentryProjectId: input.sentryProjectId,
    name: input.name, label: input.label ?? null, metadata: {}, addedByUserId: input.addedByUserId,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<SentryTarget>(await ref.get());
}

export async function removeSentryTarget(db: Db, projectId: string, targetId: string): Promise<boolean> {
  const ref = col(db, 'sentry_targets').doc(targetId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data()?.projectId as string) !== projectId) return false;
  await ref.delete();
  return true;
}

export function toPublicSentryTarget(row: SentryTarget): SentryTargetPublic {
  return row;
}
