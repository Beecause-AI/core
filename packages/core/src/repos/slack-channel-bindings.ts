import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import { AlreadyExistsError } from '../ports/store.js';
import type { SlackChannelBinding } from '../store/types.js';

/** Deterministic doc id for the (orgIntegrationId, slackChannelId) unique pair. */
function bindingId(orgIntegrationId: string, slackChannelId: string): string {
  return `${orgIntegrationId}_${slackChannelId}`;
}

export async function getBinding(db: Db, orgIntegrationId: string, slackChannelId: string): Promise<SlackChannelBinding | null> {
  const snap = await col(db, 'slack_channel_bindings').doc(bindingId(orgIntegrationId, slackChannelId)).get();
  return snap.exists ? fromDoc<SlackChannelBinding>(snap) : null;
}

export async function upsertPendingBinding(
  db: Db, input: { orgIntegrationId: string; slackChannelId: string; channelName?: string | null },
): Promise<SlackChannelBinding> {
  const ref = col(db, 'slack_channel_bindings').doc(bindingId(input.orgIntegrationId, input.slackChannelId));
  // onConflictDoNothing: only create if absent; existing rows are left untouched.
  const row = applyDefaults({
    orgIntegrationId: input.orgIntegrationId, slackChannelId: input.slackChannelId,
    channelName: input.channelName ?? null, projectId: null as string | null,
    status: 'pending', createdByUserId: null as string | null,
  }, ref.id);
  await ref.create(toDoc(row)).catch((e: unknown) => { if (!(e instanceof AlreadyExistsError)) throw e; });
  return (await getBinding(db, input.orgIntegrationId, input.slackChannelId))!;
}

export async function setBinding(
  db: Db,
  input: { orgIntegrationId: string; slackChannelId: string; projectId: string; createdByUserId?: string | null },
): Promise<SlackChannelBinding> {
  const ref = col(db, 'slack_channel_bindings').doc(bindingId(input.orgIntegrationId, input.slackChannelId));
  // onConflictDoUpdate: merge-set the bound fields (id/createdAt preserved on existing rows).
  const row = applyDefaults({
    orgIntegrationId: input.orgIntegrationId, slackChannelId: input.slackChannelId,
    projectId: input.projectId, status: 'bound',
    createdByUserId: input.createdByUserId ?? null,
  }, ref.id);
  await ref.set(toDoc(row), { merge: true });
  return (await getBinding(db, input.orgIntegrationId, input.slackChannelId))!;
}

export async function listBindings(db: Db, orgIntegrationId: string): Promise<SlackChannelBinding[]> {
  const snaps = await col(db, 'slack_channel_bindings').where('orgIntegrationId', '==', orgIntegrationId).get();
  return snaps.map((d) => fromDoc<SlackChannelBinding>(d));
}

export async function listBindingsForProject(db: Db, orgIntegrationId: string, projectId: string): Promise<SlackChannelBinding[]> {
  const snaps = await col(db, 'slack_channel_bindings')
    .where('orgIntegrationId', '==', orgIntegrationId)
    .where('projectId', '==', projectId)
    .get();
  return snaps.map((d) => fromDoc<SlackChannelBinding>(d));
}

/** A project's bound channels keyed by project_id alone (a project has one org →
 *  one slack integration), so callers needn't resolve the integration first. */
export async function listSlackBindingsByProject(db: Db, projectId: string): Promise<SlackChannelBinding[]> {
  const snaps = await col(db, 'slack_channel_bindings').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<SlackChannelBinding>(d));
}

export async function listAvailableBindings(db: Db, orgIntegrationId: string): Promise<SlackChannelBinding[]> {
  const snaps = await col(db, 'slack_channel_bindings')
    .where('orgIntegrationId', '==', orgIntegrationId)
    .where('projectId', '==', null)
    .get();
  return snaps.map((d) => fromDoc<SlackChannelBinding>(d));
}

export async function deleteBinding(db: Db, orgIntegrationId: string, slackChannelId: string): Promise<boolean> {
  const ref = col(db, 'slack_channel_bindings').doc(bindingId(orgIntegrationId, slackChannelId));
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return snap.exists;
}
